import { parsePersonalizationPatch } from "../validation.js";

const defaults = {
  baseStyleTone: "default",
  warmth: "default",
  enthusiasm: "default",
  headerAndLists: "default",
  emoji: "default",
  fastAnswers: false,
  customInstructions: "",
} as const;

function publicPersonalization(settings: typeof defaults) {
  return {
    baseStyleTone: settings.baseStyleTone,
    warmth: settings.warmth,
    enthusiasm: settings.enthusiasm,
    headerAndLists: settings.headerAndLists,
    emoji: settings.emoji,
    fastAnswers: settings.fastAnswers,
    customInstructions: settings.customInstructions,
  };
}

export class PersonalizationService {
  constructor(private readonly repositories: { personalizationSettings: { upsert: Function } }) {}

  async get(userId: string) {
    const settings = await this.repositories.personalizationSettings.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
    return publicPersonalization(settings);
  }

  async update(userId: string, input: unknown, _requestId?: string) {
    const parsed = parsePersonalizationPatch(input);
    const settings = await this.repositories.personalizationSettings.upsert({
      where: { userId },
      update: parsed,
      create: { userId, ...defaults, ...parsed },
    });
    return publicPersonalization(settings);
  }
}
