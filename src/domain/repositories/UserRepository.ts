import { User } from '../entities/User';

export interface UserRepository {
	findById(id: string): Promise<User | null>;
	create(user: User): Promise<boolean>;
	update(user: Partial<User>): Promise<boolean>;
	delete(user: User): Promise<boolean>;
}