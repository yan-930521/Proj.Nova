import { AbstractSublevel } from 'abstract-level';
import { readFile, writeFile } from 'fs/promises';
import { Level } from 'level';
import { join } from 'path';

import { MemoryCube, MemoryCubeData } from '../../application/memory/MemoryCube';
import { MemoryEdge } from '../../application/memory/tree/MemoryEdge';
import { MemoryNode } from '../../application/memory/tree/MemoryNode';
import { ComponentContainer } from '../../ComponentContainer';
import { GraphRepository } from '../../domain/repositories/GraphRepository';

export class JsonCubeLoader {
	static async save(cubeId: string, cude: MemoryCubeData): Promise<boolean> {
		try {
			const path = join(
				ComponentContainer.getConfig().cubeDatabase.dir,
				ComponentContainer.getConfig().cubeDatabase.name,
				`${cubeId}.json`
			)
			await writeFile(path, JSON.stringify(
				cude,
				null,
				4
			), 'utf-8');
			return true;
		} catch (err) {
		}
		return false;
	}

	static async load(cubeId: string): Promise<MemoryCubeData> {
		try {
			const path = join(
				ComponentContainer.getConfig().cubeDatabase.dir,
				ComponentContainer.getConfig().cubeDatabase.name,
				`${cubeId}.json`
			);
			const strData = await readFile(path, 'utf-8');
			return JSON.parse(strData);
		} catch (err) {
			throw err;
		}
	}
}