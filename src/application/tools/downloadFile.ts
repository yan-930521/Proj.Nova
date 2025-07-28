import axios from 'axios';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { z } from 'zod';

import { tool } from '@langchain/core/tools';

import { ComponentContainer } from '../../ComponentContainer';

export const webFetchTool = tool(
    async ({ url, filePath }) => {
        try {
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            const safePath = join(ComponentContainer.getConfig().AppDir, "temp", filePath);
            await writeFile(safePath, response.data);
            return `File downloaded successfully to ${safePath}`;
        } catch (error) {
            let msg = `Failed to download file: ${error instanceof Error ? error.message : error}`;
            return msg;
        }
    },
    {
        name: "web_fetch",
        description: "A tool for fetch files from a given URL.",
        schema: z.object({
            url: z.string().describe("The URL of the file to download."),
            filePath: z.string().describe("The path where the downloaded file will be saved."),
        }),
    }
);