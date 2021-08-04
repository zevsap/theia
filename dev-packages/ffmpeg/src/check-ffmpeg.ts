/********************************************************************************
 * Copyright (C) 2019 Ericsson and others.
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

import * as ffmpeg from './ffmpeg';

export function checkFfmpeg(options: ffmpeg.FfmpegOptions): void {
    const {
        ffmpegPath = ffmpeg.ffmpegAbsolutePath(options),
    } = options;
    const codecs = ffmpeg.getFfmpegCodecs(ffmpegPath);
    const bad = new Set(['h264', 'aac']);
    const found = [];
    for (const codec of codecs) {
        if (bad.has(codec.name.toLowerCase())) {
            found.push(codec);
        }
    }
    if (found.length > 0) {
        throw new Error(`${found.length} bad / ${codecs.length} found\n${
            found.map(codec => `> ${codec.name} detected (${codec.longName})`).join('\n')}`);
    }
    console.info(`"${ffmpegPath}" does not contain proprietary codecs (${codecs.length} found).`);
}
