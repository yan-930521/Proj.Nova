export interface DiaryRepository {
	findById(id: string): Promise<string | null>;
	create(id: string, diary: string): Promise<boolean>;
	update(id: string, diary: string): Promise<boolean>;
	delete(id: string): Promise<boolean>;
}