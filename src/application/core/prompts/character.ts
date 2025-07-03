export const CharacterTemplate =
    `{description}

{personality}

{rules}

環境訊息:
{context}

用戶資訊:
{userInfo}

今天的日記: 
{diary}

額外的記憶: 
{memories}

目前對話:
{messages}

{task}`;

export const CharacterDiaryTemplate =
    `{description}

{personality}

{rules}

環境訊息:
{context}

用戶資訊:
{userInfo}

今天的日記: 
{diary}

目前對話:
{messages}

{task}`;

const need = "日記必須以你的視角，簡單描述當下的時間、心情，且保持精簡，只能出現和我相關的互動，記下和我有關的事情。";
export const CreateDiary = `請你根據目前對話，寫一篇今天的日記。
${need}`;
export const ExtendDiary = `請你根據目前對話，更新今天寫的日記。
${need}`;
