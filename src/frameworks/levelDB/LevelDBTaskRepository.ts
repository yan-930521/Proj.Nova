import { Task } from '../../application/task/Task';
import { User } from '../../domain/entities/User';
import { TaskRepository } from '../../domain/repositories/TaskRepository';

export class LevelDBTaskRepository implements TaskRepository {

	private tasks: Task[] = [];

	private static instance: LevelDBTaskRepository;

	constructor() {

	}

	static getInstance(): LevelDBTaskRepository {
		if (!LevelDBTaskRepository.instance) {
			LevelDBTaskRepository.instance = new LevelDBTaskRepository();
		}
		return LevelDBTaskRepository.instance;
	}


	async findAll(): Promise<Task[]> {
		return this.tasks;
	}

	async findById(id: string): Promise<Task | null> {
		return this.tasks.find(task => task.id === id) || null;
	}

	async findByMetadata(taskData: Partial<Task>): Promise<Task[]> {
		return this.tasks.filter(task => {
			return Object.entries(taskData).every(([key, value]) => {
				// 特殊處理 user.id 等巢狀屬性
				if (key === 'user' && (value as User)?.id) {
					return task.user?.id === (value as User).id;
				}
				// 一般直接比對
				return task[key as keyof Task] === value;
			});
		});
	}

	async create(task: Task): Promise<Task> {
		this.tasks.push(task);
		return task;
	}

	async delete(id: string): Promise<void> {
		throw new Error('Method not implemented.');
	}


	async update(task: Task): Promise<void> {
		const index = this.tasks.findIndex(t => t.id === task.id);
		if (index !== -1) {
			this.tasks[index] = task;
		}
	}
}
