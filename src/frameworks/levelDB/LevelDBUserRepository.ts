import { AbstractSublevel } from 'abstract-level';
import { Level } from 'level';

import { User } from '../../domain/entities/User';
import { UserRepository } from '../../domain/repositories/UserRepository';
import { LevelDB } from './LevelDB';

export class LevelDBUserRepository implements UserRepository {
	private users: AbstractSublevel<Level<string, string>, string | any, string, string>
	private tempUsers: Record<string, User> = {};

	private static instance: LevelDBUserRepository;

	constructor() {
		this.users = LevelDB.getInstance().sublevel<string, string>("users", {
			valueEncoding: "utf8"
		});
	}

	static getInstance(): LevelDBUserRepository {
		if (!LevelDBUserRepository.instance) {
			LevelDBUserRepository.instance = new LevelDBUserRepository();
		}
		return LevelDBUserRepository.instance;
	}

	async findById(id: string): Promise<User | null> {
		try {
			let user = this.tempUsers[id];
			if(!user) {
				let userdata = await this.users.get(id);
				if(userdata) {
					user = User.fromJSON(JSON.parse(userdata));
				}
			}
			return user ?? null;

		} catch (err) {
		}
		return null;
	}

	async create(user: User): Promise<boolean> {
		try {
			let exist = await this.users.get(user.id);
			if (!exist) {
				this.tempUsers[user.id] = user;
				await this.users.put(user.id, JSON.stringify(user));
				return true;
			}
		} catch (err) {
		}
		return false;
	}

	async update(user: User): Promise<boolean> {
		try {
			this.tempUsers[user.id] = user;
			await this.users.put(user.id, JSON.stringify(user));
			return true;
		} catch (err) {
		}
		return false;
	}

	async delete(user: User): Promise<boolean> {
		try {
			delete this.tempUsers[user.id];
			await this.users.del(user.id);
			return true;
		} catch (err) {
		}
		return false;
	}
}