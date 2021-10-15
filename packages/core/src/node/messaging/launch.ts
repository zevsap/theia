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

import { createConnection } from '../../common/messaging/connection';
import { WebSocketMessageReader, WebSocketMessageWriter } from '../../common/messaging/socket-message-handlers';
import { IWebSocket, IWebSocketConnection } from '../../common/messaging/web-socket-channel';

// Copied from https://github.com/CodinGame/monaco-jsonrpc/blob/e3eea9123da2cc11845c409bcfae8e44b7d3a0e6/src/server/launch.ts
export function createWebSocketConnection(socket: IWebSocket): IWebSocketConnection {
    const reader = new WebSocketMessageReader(socket);
    const writer = new WebSocketMessageWriter(socket);
    return createConnection(reader, writer, () => socket.dispose(), { socket });
}
