import { HumanMessage, RemoveMessage } from '@langchain/core/messages';
import {
    ChatPromptTemplate, HumanMessagePromptTemplate, SystemMessagePromptTemplate
} from '@langchain/core/prompts';
import { StateType } from '@langchain/langgraph';

import { LevelDBDiaryRepository } from '../../../frameworks/levelDB/LevelDBDiaryRepository';
import { BaseAgent, BaseAgentCallOptions } from '../../../libs/base/BaseAgent';
import {
    CharacterDiaryTemplate, CharacterTemplate, CreateDiary, ExtendDiary
} from '../prompts/character';
import { Character } from './Character';

export class DiaryWriter<ParentStateType extends StateType<any> = {}> extends BaseAgent<ParentStateType> {
    constructor(options: BaseAgentCallOptions) {
        super({
            name: "DiaryWriter",
            ...options
        });
    }

    async initLogic(): Promise<void> {
        this._prompt = DiaryWriter.loadPrompt();
        this._chain = this.prompt.pipe(this.llm);
        this.node = async (state: ParentStateType) => {
            this.logger.info("Writing Diary...");

            const { diary, messages, character, user, task } = state;

            const action = diary == "" ? CreateDiary : ExtendDiary.replace("%diary%", diary);

            const response = await this.chain.invoke(Character.formatCharacter({
                description: character.description,
                personality: character.personality,
                rules: character.rules,
                context: Character.createContext(),
                userInfo: JSON.stringify(user),
                user,
                task,
                diary,
                messages,
                input: action,
            }, character));

            // 留8則
            const deleteMessages = messages.slice(0, -8).map((m: HumanMessage) => new RemoveMessage({ id: m.id as string }));
            if (typeof response.content !== "string") {
                throw new Error("Expected a string response from the model");
            }

            await LevelDBDiaryRepository.getInstance().update(
                new Date().toLocaleDateString(),
                response.content
            );

            this.logger.debug(response.content);

            return { diary: response.content, messages: deleteMessages };
        }
    }

    node(state: ParentStateType) {
        throw new Error('Method not implemented.');
    }

    /**
     * 載入prompt
     */
    static loadPrompt() {
        return ChatPromptTemplate.fromMessages([
            SystemMessagePromptTemplate.fromTemplate(CharacterDiaryTemplate),
            HumanMessagePromptTemplate.fromTemplate("{input}")
        ]);// .replace(new RegExp("{{char}}", 'g'), charactor.name)
    }

}