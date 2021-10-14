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

import { MessageReader, MessageWriter, Message, createMessageConnection, Logger, MessageConnection } from 'vscode-languageserver-protocol';
import { Disposable, DisposableCollection } from '../../common';
import { WebSocketMessageReader, WebSocketMessageWriter } from './socket-message-handlers';
import { IWebSocket } from './web-socket-channel';

// Copied from https://github.com/CodinGame/monaco-jsonrpc/blob/e3eea9123da2cc11845c409bcfae8e44b7d3a0e6/src/server/connection.ts
export interface IConnection extends Disposable {
    readonly reader: MessageReader;
    readonly writer: MessageWriter;
    forward(to: IConnection, map?: (message: Message) => Message): void;
    onClose(callback: () => void): Disposable;
}

// Copied from https://github.com/CodinGame/monaco-jsonrpc/blob/e3eea9123da2cc11845c409bcfae8e44b7d3a0e6/src/socket/connection.ts
export function createWebSocketConnection(socket: IWebSocket, logger: Logger): MessageConnection {
    const messageReader = new WebSocketMessageReader(socket);
    const messageWriter = new WebSocketMessageWriter(socket);
    const connection = createMessageConnection(messageReader, messageWriter, logger);
    connection.onClose(() => connection.dispose());
    return connection;
}

// Copied from https://github.com/CodinGame/monaco-jsonrpc/blob/e3eea9123da2cc11845c409bcfae8e44b7d3a0e6/src/server/connection.ts
export function createConnection<T extends {}>(reader: MessageReader, writer: MessageWriter, onDispose: () => void,
    extensions: T = {} as T): IConnection & T {
    const disposeOnClose = new DisposableCollection();
    reader.onClose(() => disposeOnClose.dispose());
    writer.onClose(() => disposeOnClose.dispose());
    return {
        reader, writer,
        forward(to: IConnection, map: (message: Message) => Message = message => message): void {
            reader.listen(input => {
                const output = map(input);
                to.writer.write(output);
            });
        },
        onClose(callback: () => void): Disposable {
            return disposeOnClose.push(Disposable.create(callback));
        },
        dispose: () => onDispose(),
        ...extensions
    };
}
