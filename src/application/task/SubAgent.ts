import { BaseAgent } from '../../libs/base/BaseAgent';

export class SubAgent extends BaseAgent {
    protected initLogic(): Promise<void | this> {
        throw new Error('Method not implemented.');
    }
    
}