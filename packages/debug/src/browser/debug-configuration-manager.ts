/********************************************************************************
 * Copyright (C) 2018 Red Hat, Inc. and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import debounce = require('p-debounce');
import { visit, parse } from 'jsonc-parser';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { Emitter, Event, WaitUntilEvent } from '@theia/core/lib/common/event';
import { EditorManager, EditorWidget } from '@theia/editor/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { PreferenceScope, PreferenceService, QuickPickValue, StorageService } from '@theia/core/lib/browser';
import { QuickPickService } from '@theia/core/lib/common/quick-pick-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { DebugConfigurationModel } from './debug-configuration-model';
import { DebugSessionOptions } from './debug-session-options';
import { DebugService } from '../common/debug-service';
import { ContextKey, ContextKeyService } from '@theia/core/lib/browser/context-key-service';
import { DebugConfiguration } from '../common/debug-common';
import { WorkspaceVariableContribution } from '@theia/workspace/lib/browser/workspace-variable-contribution';
import { PreferenceConfigurations } from '@theia/core/lib/browser/preferences/preference-configurations';
import { MonacoTextModelService } from '@theia/monaco/lib/browser/monaco-text-model-service';

export interface WillProvideDebugConfiguration extends WaitUntilEvent {
}

export interface DebugSessionOptionsData { name: string, workspaceFolderUri?: string, providerType?: string };

@injectable()
export class DebugConfigurationManager {

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;
    @inject(EditorManager)
    protected readonly editorManager: EditorManager;
    @inject(DebugService)
    protected readonly debug: DebugService;
    @inject(QuickPickService)
    protected readonly quickPickService: QuickPickService;

    @inject(ContextKeyService)
    protected readonly contextKeyService: ContextKeyService;

    @inject(MonacoTextModelService)
    protected readonly textModelService: MonacoTextModelService;

    @inject(PreferenceService)
    protected readonly preferences: PreferenceService;

    @inject(PreferenceConfigurations)
    protected readonly preferenceConfigurations: PreferenceConfigurations;

    @inject(WorkspaceVariableContribution)
    protected readonly workspaceVariables: WorkspaceVariableContribution;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    protected readonly onWillProvideDebugConfigurationEmitter = new Emitter<WillProvideDebugConfiguration>();
    readonly onWillProvideDebugConfiguration: Event<WillProvideDebugConfiguration> = this.onWillProvideDebugConfigurationEmitter.event;

    protected readonly onWillProvideDynamicDebugConfigurationEmitter = new Emitter<WillProvideDebugConfiguration>();
    get onWillProvideDynamicDebugConfiguration(): Event<WillProvideDebugConfiguration> {
        return this.onWillProvideDynamicDebugConfigurationEmitter.event;
    }

    get onDidConfigurationProvidersChanged(): Event<void> {
        return this.debug.onDidChangeDebugConfigurationProviders;
    }

    protected debugConfigurationTypeKey: ContextKey<string>;

    protected initialized: Promise<void>;

    protected dynamicDebugConfigurationsPerType?: { type: string, configurations: DebugConfiguration[] }[];
    protected recentDynamicOptionsTracker: DebugSessionOptions[] = [];
    protected loadingDataCache: DebugConfigurationManager.Data = { current: undefined, recentDynamicOptions: [] };
    protected initialCurrentHasChanged = false;

    @postConstruct()
    protected async init(): Promise<void> {
        this.debugConfigurationTypeKey = this.contextKeyService.createKey<string>('debugConfigurationType', undefined);
        this.initialized = this.preferences.ready.then(() => {
            this.preferences.onPreferenceChanged(e => {
                if (e.preferenceName === 'launch') {
                    this.updateModels();
                }
            });
            return this.updateModels();
        });
    }

    protected readonly models = new Map<string, DebugConfigurationModel>();
    protected updateModels = debounce(async () => {
        const roots = await this.workspaceService.roots;
        const toDelete = new Set(this.models.keys());
        for (const rootStat of roots) {
            const key = rootStat.resource.toString();
            toDelete.delete(key);
            if (!this.models.has(key)) {
                const model = new DebugConfigurationModel(key, this.preferences);
                model.onDidChange(() => this.updateCurrent());
                model.onDispose(() => this.models.delete(key));
                this.models.set(key, model);
            }
        }
        for (const uri of toDelete) {
            const model = this.models.get(uri);
            if (model) {
                model.dispose();
            }
        }
        this.updateCurrent();
    }, 500);

    /**
     * All _non-dynamic_ debug configurations.
     */
    get all(): IterableIterator<DebugSessionOptions> {
        return this.getAll();
    }
    protected *getAll(): IterableIterator<DebugSessionOptions> {
        for (const model of this.models.values()) {
            for (const configuration of model.configurations) {
                yield {
                    configuration,
                    workspaceFolderUri: model.workspaceFolderUri
                };
            }
        }
    }

    get supported(): Promise<IterableIterator<DebugSessionOptions>> {
        return this.getSupported();
    }
    protected async getSupported(): Promise<IterableIterator<DebugSessionOptions>> {
        await this.initialized;
        const debugTypes = await this.debug.debugTypes();
        return this.doGetSupported(new Set(debugTypes));
    }
    protected *doGetSupported(debugTypes: Set<string>): IterableIterator<DebugSessionOptions> {
        for (const options of this.getAll()) {
            if (debugTypes.has(options.configuration.type)) {
                yield options;
            }
        }
    }

    protected _currentOptions: DebugSessionOptions | undefined;
    get current(): DebugSessionOptions | undefined {
        return this._currentOptions;
    }

    selectionChanged(option: DebugSessionOptions | undefined): void {
        this.current = option;
        this.initialCurrentHasChanged = true;
    }

    set current(option: DebugSessionOptions | undefined) {
        this.updateCurrent(option);
        this.updateRecentlyUsedDynamicConfigurationOptions(option);
    }

    protected updateRecentlyUsedDynamicConfigurationOptions(option: DebugSessionOptions | undefined): void {
        if (option?.providerType) { // if it's a dynamic configuration option
            // Removing an item already present in the list
            const index = this.recentDynamicOptionsTracker.findIndex(item => this.dynamicOptionsMatch(item, option));
            if (index > -1) {
                this.recentDynamicOptionsTracker.splice(index, 1);
            }
            // Adding new item, most recent at the top of the list
            if (this.recentDynamicOptionsTracker.push(option) > 3) {
                // Remove oldest, i.e. Keeping a short number of recently used
                // configuration options
                this.recentDynamicOptionsTracker.shift();
            }
        }
    }

    protected dynamicOptionsMatch(one: DebugSessionOptions, other: DebugSessionOptions): boolean {
        return one.providerType !== undefined
        && other.providerType !== undefined
        && one.configuration.name === other.configuration.name
        && one.providerType === other.providerType;
    }

    get recentDynamicOptions(): DebugSessionOptions[] {
        this.resolveRecentDynamicOptionsFromData();
        // Most recent first
        return [...this.recentDynamicOptionsTracker].reverse();
    }

    protected updateCurrent(options: DebugSessionOptions | undefined = this._currentOptions): void {
        this._currentOptions = options && this.find(options.configuration.name, options.workspaceFolderUri, options.providerType);

        if (!this._currentOptions) {
            const { model } = this;
            if (model) {
                const configuration = model.configurations[0];
                if (configuration) {
                    this._currentOptions = {
                        configuration,
                        workspaceFolderUri: model.workspaceFolderUri
                    };
                }
            }
        }
        this.debugConfigurationTypeKey.set(this.current && this.current.configuration.type);
        this.onDidChangeEmitter.fire(undefined);
    }

    find(name: string, workspaceFolderUri?: string, providerType?: string): DebugSessionOptions | undefined {
        // providerType is only applicable to dynamic debug configurations
        if (providerType && this.dynamicDebugConfigurationsPerType) {
            for (const { type, configurations } of this.dynamicDebugConfigurationsPerType) {
                for (const configuration of configurations) {
                    // For dynamic configurations configurationType => providerType
                    if (configuration.name === name && type === providerType) {
                        return {
                            configuration,
                            providerType: type
                        };
                    }
                }
            }
        }
        for (const model of this.models.values()) {
            if (model.workspaceFolderUri === workspaceFolderUri) {
                for (const configuration of model.configurations) {
                    if (configuration.name === name) {
                        return {
                            configuration,
                            workspaceFolderUri
                        };
                    }
                }
            }
        }
        return undefined;
    }

    async openConfiguration(): Promise<void> {
        const { model } = this;
        if (model) {
            await this.doOpen(model);
        }
    }

    async addConfiguration(): Promise<void> {
        const { model } = this;
        if (!model) {
            return;
        }
        const widget = await this.doOpen(model);
        if (!(widget.editor instanceof MonacoEditor)) {
            return;
        }
        const editor = widget.editor.getControl();
        const { commandService } = widget.editor;
        let position: monaco.Position | undefined;
        let depthInArray = 0;
        let lastProperty = '';
        visit(editor.getValue(), {
            onObjectProperty: property => {
                lastProperty = property;
            },
            onArrayBegin: offset => {
                if (lastProperty === 'configurations' && depthInArray === 0) {
                    position = editor.getModel()!.getPositionAt(offset + 1);
                }
                depthInArray++;
            },
            onArrayEnd: () => {
                depthInArray--;
            }
        });
        if (!position) {
            return;
        }
        // Check if there are more characters on a line after a "configurations": [, if yes enter a newline
        if (editor.getModel()!.getLineLastNonWhitespaceColumn(position.lineNumber) > position.column) {
            editor.setPosition(position);
            editor.trigger('debug', 'lineBreakInsert', undefined);
        }
        // Check if there is already an empty line to insert suggest, if yes just place the cursor
        if (editor.getModel()!.getLineLastNonWhitespaceColumn(position.lineNumber + 1) === 0) {
            editor.setPosition({ lineNumber: position.lineNumber + 1, column: 1 << 30 });
            await commandService.executeCommand('editor.action.deleteLines');
        }
        editor.setPosition(position);
        await commandService.executeCommand('editor.action.insertLineAfter');
        await commandService.executeCommand('editor.action.triggerSuggest');
    }

    protected get model(): DebugConfigurationModel | undefined {
        const workspaceFolderUri = this.workspaceVariables.getWorkspaceRootUri();
        if (workspaceFolderUri) {
            const key = workspaceFolderUri.toString();
            for (const model of this.models.values()) {
                if (model.workspaceFolderUri === key) {
                    return model;
                }
            }
        }
        for (const model of this.models.values()) {
            if (model.uri) {
                return model;
            }
        }
        return this.models.values().next().value;
    }

    protected async doOpen(model: DebugConfigurationModel): Promise<EditorWidget> {
        const uri = await this.doCreate(model);

        return this.editorManager.open(uri, {
            mode: 'activate'
        });
    }

    protected async doCreate(model: DebugConfigurationModel): Promise<URI> {
        const uri = model.uri ?? this.preferences.getConfigUri(PreferenceScope.Folder, model.workspaceFolderUri, 'launch');
        if (!uri) { // Since we are requesting information about a known workspace folder, this should never happen.
            throw new Error('PreferenceService.getConfigUri has returned undefined when a URI was expected.');
        }
        const settingsUri = this.preferences.getConfigUri(PreferenceScope.Folder, model.workspaceFolderUri);
        // Users may have placed their debug configurations in a `settings.json`, in which case we shouldn't modify the file.
        if (settingsUri && !uri.isEqual(settingsUri)) {
            await this.ensureContent(uri, model);
        }
        return uri;
    }

    /**
     * Checks whether a `launch.json` file contains the minimum necessary content.
     * If content not found, provides content and populates the file using Monaco.
     */
    protected async ensureContent(uri: URI, model: DebugConfigurationModel): Promise<void> {
        const textModel = await this.textModelService.createModelReference(uri);
        const currentContent = textModel.object.valid ? textModel.object.getText() : '';
        try { // Look for the minimal well-formed launch.json content: {configurations: []}
            const parsedContent = parse(currentContent);
            if (Array.isArray(parsedContent.configurations)) {
                return;
            }
        } catch {
            // Just keep going
        }
        const debugType = await this.selectDebugType();
        const configurations = debugType ? await this.provideDebugConfigurations(debugType, model.workspaceFolderUri) : [];
        const content = this.getInitialConfigurationContent(configurations);
        textModel.object.textEditorModel.setValue(content); // Will clobber anything the user has entered!
        await textModel.object.save();
    }

    protected async provideDebugConfigurations(debugType: string, workspaceFolderUri: string | undefined): Promise<DebugConfiguration[]> {
        await this.fireWillProvideDebugConfiguration();
        return this.debug.provideDebugConfigurations(debugType, workspaceFolderUri);
    }
    protected async fireWillProvideDebugConfiguration(): Promise<void> {
        await WaitUntilEvent.fire(this.onWillProvideDebugConfigurationEmitter, {});
    }

    async provideDynamicDebugConfigurations(): Promise<{ type: string, configurations: DebugConfiguration[] }[]> {
        await this.initialized;
        await this.fireWillProvideDynamicDebugConfiguration();
        this.dynamicDebugConfigurationsPerType = await this.debug.provideDynamicDebugConfigurations!();
        // Refreshing current dynamic configuration i.e. could be using a different option like "program"
        this.updateCurrent(this.current);
        return this.dynamicDebugConfigurationsPerType;
    }

    protected async fireWillProvideDynamicDebugConfiguration(): Promise<void> {
        await WaitUntilEvent.fire(this.onWillProvideDynamicDebugConfigurationEmitter, {});
    }

    protected getInitialConfigurationContent(initialConfigurations: DebugConfiguration[]): string {
        return `{
  // Use IntelliSense to learn about possible attributes.
  // Hover to view descriptions of existing attributes.
  "version": "0.2.0",
  "configurations": ${JSON.stringify(initialConfigurations, undefined, '  ').split('\n').map(line => '  ' + line).join('\n').trim()}
}
`;
    }

    protected async selectDebugType(): Promise<string | undefined> {
        const widget = this.editorManager.currentEditor;
        if (!widget) {
            return undefined;
        }
        const { languageId } = widget.editor.document;
        const debuggers = await this.debug.getDebuggersForLanguage(languageId);
        if (debuggers.length === 0) {
            return undefined;
        }
        const items: Array<QuickPickValue<string>> = debuggers.map(({ label, type }) => ({ label, value: type }));
        const selectedItem = await this.quickPickService.show(items, { placeholder: 'Select Environment' });
        return selectedItem?.value;
    }

    @inject(StorageService)
    protected readonly storage: StorageService;

    async load(): Promise<void> {
        await this.initialized;
        const data = await this.storage.getData<DebugConfigurationManager.Data>('debug.configurations', {});
        if (data.current) {
            this.current = this.find(data.current.name, data.current.workspaceFolderUri, data.current.providerType);
        }

        this.loadingDataCache = data;
        this.resolveRecentDynamicOptionsFromData();
    }

    private resolveRecentDynamicOptionsFromData(): void {
        // If already resolved or input data is empty, return
        if (this.recentDynamicOptionsTracker.length > 0 ||
            !this.dynamicDebugConfigurationsPerType ||
            this.dynamicDebugConfigurationsPerType.length < 1) {
            return;
        }

        const optionsList = this.loadingDataCache.recentDynamicOptions;
        if (!optionsList) {
            return;
        }

        for (const options of optionsList) {
            const configuration = this.find(options.name, undefined, options.providerType);
            if (configuration) {
                this.recentDynamicOptionsTracker.push(configuration);
            }
        }

        // If the current configuration from the local storage in cache is dynamic, restore it as the actual
        // current, but only if
        // dynamic configurations have just been loaded (i.e. found, therefore provided) and
        // the initial configuration has not been changed by the user
        const cachedCurrent = this.loadingDataCache.current;
        if (cachedCurrent &&
            cachedCurrent.providerType &&
            this.recentDynamicOptionsTracker.length > 0 &&
            !this.initialCurrentHasChanged) {

            const configuration = this.find(cachedCurrent.name, cachedCurrent.workspaceFolderUri, cachedCurrent.providerType);
            if (configuration) {
                this.current = configuration;
            }
        }
    }

    save(): void {
        const data: DebugConfigurationManager.Data = {};
        const { current, recentDynamicOptionsTracker } = this;
        if (current) {
            data.current = {
                name: current.configuration.name,
                workspaceFolderUri: current.workspaceFolderUri,
                providerType: current.providerType
            };
        }
        if (this.recentDynamicOptionsTracker.length > 0) {
            const recentDynamicOptionsData = [];
            for (const options of recentDynamicOptionsTracker) {
                recentDynamicOptionsData.push({
                    name: options.configuration.name,
                    providerType: options.providerType!
                });
            }
            data.recentDynamicOptions = recentDynamicOptionsData;
        }
        this.storage.setData('debug.configurations', data);
    }
}

export namespace DebugConfigurationManager {
    export interface Data {
        current?: DebugSessionOptionsData,
        recentDynamicOptions?: DebugSessionOptionsData[]
    }
}
