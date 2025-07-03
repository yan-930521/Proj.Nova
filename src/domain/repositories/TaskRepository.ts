import { Task } from '../entities/Task';

export interface TaskRepository {
  findAll(): Promise<Task[]>;
  findById(id: string): Promise<Task | null>;
  create(task: Task): Promise<Task>;
  update(task: Task): Promise<void>;
  delete(id: string): Promise<void>;
}