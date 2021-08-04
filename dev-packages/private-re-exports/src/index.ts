/********************************************************************************
 * Copyright (C) 2021 Ericsson and others.
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

export interface ReExportDeclaration {
    'export *': string[]
    'export =': string[]
}

export interface ReExport {
    star: ExportStar[]
    equal: ExportEqual[]
}

export interface ExportStar {
    module: string
    alias?: string
}

export interface ExportEqual {
    module: string
    namespace: string
    alias?: string
}

export interface GeneratedReExport {
    js: string
    dts: string
}

export interface PackageJson {
    dependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
    theiaReExports?: ReExportDeclaration
}

export interface ReExportInfo {
    packageName: string
    versionRange: string
}

export class PackageReExport {

    protected exportStar: ExportStar[] = [];
    protected exportEqual: ExportEqual[] = [];

    constructor(
        protected packageJson: PackageJson,
        readonly reExportPrefix: string,
    ) {
        if (packageJson.theiaReExports) {
            const { star, equal } = parseReExport(packageJson.theiaReExports);
            this.exportStar = star;
            this.exportEqual = equal;
        } else {
            this.exportStar = [];
            this.exportEqual = [];
        }
    }

    get modules(): string[] {
        return [
            ...this.exportStar.map(star => star.module),
            ...this.exportEqual.map(equal => equal.module),
        ].sort();
    }

    generateReExports(
        transform?: <T extends ExportStar | ExportEqual>(exp: T) => T,
    ): {
        export: ExportStar | ExportEqual
        generated: GeneratedReExport
    }[] {
        return [
            ...this.exportStar.map(star => ({ export: star, generated: generateExportStar(transform?.(star) ?? star) })),
            ...this.exportEqual.map(equal => ({ export: equal, generated: generateExportEqual(transform?.(equal) ?? equal) })),
        ];
    }

    /**
     * Given a module name like `a/b/c` it will return true if it is possible
     * to import it as `<re-export-prefix>/a/b/c`.
     */
    isReExported(moduleName: string): boolean {
        return this.modules.includes(moduleName);
    }

    /**
     * Given an import like `<re-export-prefix>/a/b/c` it will return `a/b/c`.
     * If the import is not from `<re-export-prefix>/...` it will return undefined.
     */
    getReExported(moduleName: string): string | undefined {
        if (moduleName.startsWith(this.reExportPrefix)) {
            const shared = moduleName.substr(this.reExportPrefix.length);
            if (shared.length > 0) {
                return shared;
            }
        }
    }

    getVersionRange(packageName: string): string | undefined {
        return this.packageJson.dependencies?.[packageName]
            ?? this.packageJson.peerDependencies?.[packageName];
    }
}

export function parseReExport(reExports: ReExportDeclaration): ReExport {
    /**
     * List of modules exported like
     * ```ts
     * export * from 'module';
     * ```
     */
    const star = reExports['export *'].map(entry => {
        const [module, alias = entry] = entry.split(':', 2);
        return { module, alias };
    });
    /**
     * List of modules exported via namespace like
     * ```ts
     * import namespace = require('module');
     * export = namespace;
     * ```
     */
    const equal = reExports['export ='].map(entry => {
        const [module, namespace = entry] = entry.split(' as ', 2);
        return { module, namespace };
    });
    return {
        star,
        equal,
    };
}

export function generateExportStar(star: ExportStar): GeneratedReExport {
    return {
        js: `module.exports = require('${star.module}');\n`,
        dts: `export * from '${star.module}';\n`
    };
}

export function generateExportEqual(equal: ExportEqual): GeneratedReExport {
    return {
        js: `module.exports = require('${equal.module}');\n`,
        dts: `import ${equal.namespace} = require('${equal.module}');\nexport = ${equal.namespace};\n`,
    };
}

/**
 * Only keep the first two parts of the package name e.g.,
 * - `@a/b/c/...` => `@a/b`
 * - `a/b/c/...` => `a`
 */
export function getPackageName(moduleName: string): string {
    const slice = moduleName.startsWith('@') ? 2 : 1;
    return moduleName.split('/', slice + 1)
        .slice(0, slice)
        .join('/');
}
