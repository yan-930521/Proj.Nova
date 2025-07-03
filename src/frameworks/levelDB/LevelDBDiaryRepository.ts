import { AbstractSublevel } from 'abstract-level';
import { Level } from 'level';

import { DiaryRepository } from '../../domain/repositories/DiaryRepository';
import { LevelDB } from './LevelDB';

export class LevelDBDiaryRepository implements DiaryRepository {
	private diarys: AbstractSublevel<Level<string, string>, string | any, string, string>

	private static instance: LevelDBDiaryRepository;
	static getInstance(): LevelDBDiaryRepository {
		if (!LevelDBDiaryRepository.instance) {
			LevelDBDiaryRepository.instance = new LevelDBDiaryRepository();
		}
		return LevelDBDiaryRepository.instance;
	}

	constructor() {
		this.diarys = LevelDB.getInstance().sublevel<string, string>("diarys", {
			valueEncoding: "utf8"
		});
	}

	async findById(id: string): Promise<string | null> {
		try {
			let diary = await this.diarys.get(id);
			return diary ?? null;

		} catch (err) {
		}
		return null;
	}

	async create(id: string, diary: string): Promise<boolean> {
		try {
			let exist = await this.diarys.get(id);
			if (!exist) {
				await this.diarys.put(id, diary);
				return true;
			}
		} catch (err) {
		}
		return false;
	}

	async update(id: string, diary: string): Promise<boolean> {
		try {
			await this.diarys.put(id, diary);
			return true;
		} catch (err) {
		}
		return false;
	}

	async delete(id: string): Promise<boolean> {
		try {
			await this.diarys.del(id);
			return true;
		} catch (err) {
		}
		return false;
	}
}