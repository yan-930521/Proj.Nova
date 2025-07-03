import { ChatOpenAI, ChatOpenAICallOptions, OpenAIEmbeddings } from '@langchain/openai';

import { ComponentContainer } from '../ComponentContainer';
import { Task } from '../domain/entities/Task';
import { BaseManager } from '../libs/base/BaseManager';

export class TaskManager extends BaseManager<Task> {
    
    constructor() {
        super({
            name: "TaskManager"
        });
    }

    protected async initLogic(): Promise<void> {
        
    }

    create(id: string, task: Task): Task {
        this.setDataById(id, task);
        return task;
    }
}