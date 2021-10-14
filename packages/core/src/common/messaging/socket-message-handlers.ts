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

import { AbstractMessageReader, MessageReader, DataCallback, AbstractMessageWriter, MessageWriter, Message, Disposable } from 'vscode-languageserver-protocol';
import { IWebSocket } from './web-socket-channel';

// Copied from https://github.com/CodinGame/monaco-jsonrpc/blob/e3eea9123da2cc11845c409bcfae8e44b7d3a0e6/src/socket/reader.ts
export class WebSocketMessageReader extends AbstractMessageReader implements MessageReader {

    protected state: 'initial' | 'listening' | 'closed' = 'initial';
    protected callback: DataCallback | undefined;
    protected readonly events: { message?: string, error?: unknown }[] = [];

    constructor(protected readonly socket: IWebSocket) {
        super();
        this.socket.onMessage(message =>
            this.readMessage(message)
        );
        this.socket.onError(error =>
            this.fireError(error)
        );
        this.socket.onClose((code, reason) => {
            if (code !== 1000) {
                const error: Error = {
                    name: '' + code,
                    message: `Error during socket reconnect: code = ${code}, reason = ${reason}`
                };
                this.fireError(error);
            }
            this.fireClose();
        });
    }

    listen(callback: DataCallback): Disposable {
        if (this.state === 'initial') {
            this.state = 'listening';
            this.callback = callback;
            while (this.events.length !== 0) {
                const event = this.events.pop()!;
                if (event.message) {
                    this.readMessage(event.message);
                } else if (event.error) {
                    this.fireError(event.error);
                } else {
                    this.fireClose();
                }
            }
        }
        return {
            dispose: () => {
                if (this.callback === callback) {
                    this.callback = undefined;
                }
            }
        };
    }

    protected readMessage(message: string): void {
        if (this.state === 'initial') {
            this.events.splice(0, 0, { message });
        } else if (this.state === 'listening') {
            const data = JSON.parse(message);
            this.callback!(data);
        }
    }

    protected fireError(error: unknown): void {
        if (this.state === 'initial') {
            this.events.splice(0, 0, { error });
        } else if (this.state === 'listening') {
            super.fireError(error);
        }
    }

    protected fireClose(): void {
        if (this.state === 'initial') {
            this.events.splice(0, 0, {});
        } else if (this.state === 'listening') {
            super.fireClose();
        }
        this.state = 'closed';
    }

}

// Copied from https://github.com/CodinGame/monaco-jsonrpc/blob/e3eea9123da2cc11845c409bcfae8e44b7d3a0e6/src/socket/writer.ts
export class WebSocketMessageWriter extends AbstractMessageWriter implements MessageWriter {

    protected errorCount = 0;

    constructor(protected readonly socket: IWebSocket) {
        super();
    }

    end(): void {
    }

    async write(msg: Message): Promise<void> {
        try {
            const content = JSON.stringify(msg);
            this.socket.send(content);
        } catch (e) {
            this.errorCount++;
            this.fireError(e, msg, this.errorCount);
        }
    }

}
