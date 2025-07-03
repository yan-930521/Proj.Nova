import { Character } from '../../domain/entities/Character';
import { CharacterRepository } from '../../domain/repositories/CharacterRepository';

export class LevelDBCharacterRepository implements CharacterRepository {
	private characters: Character[] = [];

	private static instance: LevelDBCharacterRepository;
	static getInstance(): LevelDBCharacterRepository {
		if (!LevelDBCharacterRepository.instance) {
			LevelDBCharacterRepository.instance = new LevelDBCharacterRepository();
		}
		return LevelDBCharacterRepository.instance;
	}

	constructor() {
	}


	async findAll(): Promise<Character[]> {
		return this.characters;
	}

	async findById(id: string): Promise<Character | null> {
		return this.characters.find(character => character.id === id) || null;
	}

	async create(character: Character): Promise<Character> {
		this.characters.push(character);
		return character;
	}

	async update(character: Character): Promise<void> {
		const index = this.characters.findIndex(c => c.id === character.id);
		if (index !== -1) {
			this.characters[index] = character;
		}
	}

	async delete(id: string): Promise<void> {
		this.characters = this.characters.filter(character => character.id !== id);
	}
}