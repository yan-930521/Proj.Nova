import fs, { mkdir, readdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { z } from 'zod';

import { tool } from '@langchain/core/tools';

import { ComponentContainer } from '../../ComponentContainer';

export const readFileTool = tool(
    async ({ path }) => {
        try {
            const safePath = join(ComponentContainer.getConfig().AppDir, "temp", path);
            const content = await readFile(safePath, "utf-8");
            return content;
        } catch (error) {
            let msg = `Failed to read file: ${error instanceof Error ? error.message : error}`;
            return msg;
        }
    },
    {
        name: "read_file",
        description: "Reads the content of a specified file.",
        schema: z.object({
            path: z.string().describe("The file path to read."),
        }),
    }
);
export const readDirTool = tool(
    async ({ path }) => {
        try {
            const safePath = join(ComponentContainer.getConfig().AppDir, "temp", path);
            const content = await readdir(safePath, "utf-8");
            return "file list: " + content.join(", ");
        } catch (error) {
            let msg = `Failed to read dir: ${error instanceof Error ? error.message : error}`;
            return msg;
        }
    },
    {
        name: "read_dir",
        description: "Reads the contents of a directory and returns a list of files.",
        schema: z.object({
            path: z.string().describe("The dir path to read."),
        }),
    }
);
export const writeFileTool = tool(
    async ({ path, content }) => {
        const safePath = join(ComponentContainer.getConfig().AppDir, "temp", path);
        try {
            const dir = dirname(safePath); // 取得目標資料夾的路徑
            await mkdir(dir, { recursive: true }); // 先建立資料夾
            await writeFile(safePath, content.replace(/\\n/g, "\n"), "utf-8");
            return `write file success.`;
        } catch (error) {
            let msg = `Failed to write file: ${error instanceof Error ? error.message : error}`;
            return msg;
        }
    },
    {
        name: "write_file",
        description: "Writes content to a specified file.",
        schema: z.object({
            path: z.string().describe("The file path to write."),
            content: z.string().describe("The content to write to the file."),
        }),
    }
);