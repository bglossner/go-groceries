export type ModelInterfaceOptions = { identifier: string; modelName?: string; skipAnyCaching?: boolean; };

export type ModelResponse = {
  data: {
    mealName: string;
    ingredients: {
      name: string;
      quantity: number;
    }[];
    tags: string[];
    recipe: string;
  };
  modelUsed?: string;
};

export abstract class Model {
  abstract getModelName(): string;
}

export class ModelSelector<ModelClient extends string, ModelType extends Model> {
  private models = new Map<ModelClient, ModelType>();
  private allowClients: ModelClient[] | undefined;
  private modelLoader: (client: ModelClient) => Promise<ModelType>;
  defaultClient: ModelClient;

  constructor(options: { defaultClientModel: ModelClient; modelLoader: (client: ModelClient) => Promise<ModelType>; allowClients?: ModelClient[] }) {
    this.allowClients = options.allowClients;
    this.modelLoader = options.modelLoader;
    this.defaultClient = options.defaultClientModel
  }

  addModel(client: ModelClient, model: ModelType) {
    this.models.set(client, model);
  }

  addModels(newModels: Partial<Record<ModelClient, ModelType>>) {
    for (const [client, model] of Object.entries(newModels) as [ModelClient, ModelType][]) {
      this.addModel(client as ModelClient, model);
    }
  }

  async getDefaultModel(): Promise<ModelType | undefined> {
    return await this.getModel(this.defaultClient);
  }

  async getModel(client: ModelClient): Promise<ModelType | undefined> {
    if (this.allowClients && !this.allowClients.includes(client)) {
      return undefined;
    }
    if (!this.models.has(client)) {
      return await this.loadModel(client);
    }
    return this.models.get(client);
  }

  private async loadModel(client: ModelClient) {
    if (!this.models.has(client)) {
      this.models.set(client, await this.modelLoader(client));
    }
    return this.models.get(client);
  }
}
