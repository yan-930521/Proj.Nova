import { Character } from '../entities/Character';

export interface CharacterRepository {
	findAll(): Promise<Character[]>;
	findById(id: string): Promise<Character | null>;
	create(character: Character): Promise<Character>;
	update(character: Character): Promise<void>;
	delete(id: string): Promise<void>;
}