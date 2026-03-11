// Tecnico: Zod valida payloads com regras declarativas.
// Crianca: Fiscal que checa se os dados chegaram certinhos.
import { z } from "zod";
import { MAP_SIZE, PlayerType } from "./game.js";

// Tecnico: Resultado padrao das funcoes validate*.
// Crianca: Diz se passou na prova e, se nao passou, mostra os erros.
type ValidationResult<T> = { ok: true; data: T } | { ok: false; errors: string[] };

// Tecnico: Regex de username.
// Crianca: Regras do nome da conta.
const usernameRegex = /^[a-zA-Z0-9_]+$/;

// Tecnico: Regex para nome do personagem.
// Crianca: Regras do nome do heroi.
const characterNameRegex = /^[a-zA-Z0-9_ ]+$/;

// Tecnico: Schema para cadastro/login.
// Crianca: Formulario de usuario e senha.
const authBodySchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "username: minimo 3 caracteres.")
    .max(20, "username: maximo 20 caracteres.")
    .regex(usernameRegex, "username: use letras, numeros e underscore."),
  password: z
    .string()
    .min(6, "password: minimo 6 caracteres.")
    .max(72, "password: maximo 72 caracteres.")
});

// Tecnico: Cadastro aceita classe inicial do personagem.
// Crianca: No registro o jogador escolhe Monk ou Warrior.
const registerBodySchema = authBodySchema.extend({
  playerType: z.nativeEnum(PlayerType).optional()
});

// Tecnico: Schema para criacao de personagem.
// Crianca: Formulario para escolher nome do heroi.
const createCharacterBodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, "name: minimo 3 caracteres.")
    .max(20, "name: maximo 20 caracteres.")
    .regex(characterNameRegex, "name: use letras, numeros, underscore e espaco.")
});

// Tecnico: Schema para atualizar inventario.
// Crianca: Diz qual slot da mochila muda.
const inventoryUpdateBodySchema = z.object({
  slot: z.number().int("slot: deve ser inteiro.").min(0, "slot: minimo 0.").max(5, "slot: maximo 5."),
  item: z
    .string()
    .trim()
    .min(1, "item: nao pode ser vazio.")
    .max(24, "item: maximo 24 caracteres.")
    .nullable()
});

// Tecnico: Schema de movimento via socket.
// Crianca: Direcao que o jogador quer andar.
const movePayloadSchema = z.object({
  x: z.number().min(-1, "x: minimo -1.").max(1, "x: maximo 1."),
  y: z.number().min(-1, "y: minimo -1.").max(1, "y: maximo 1.")
});

// Tecnico: Schema de ataque via socket (evento "atack").
// Crianca: Cliente manda direcao do golpe (pode ser diagonal) e alcance.
const attackPayloadSchema = z.object({
  dirX: z.number().min(-1, "dirX: minimo -1.").max(1, "dirX: maximo 1."),
  dirY: z.number().min(-1, "dirY: minimo -1.").max(1, "dirY: maximo 1."),
  range: z.number().min(0.5, "range: minimo 0.5.").max(3, "range: maximo 3.").optional()
});

const mapObjectSchema = z.object({
  id: z.string().trim().min(1, "objects.id: obrigatorio.").max(48, "objects.id: maximo 48 caracteres."),
  name: z
    .string()
    .trim()
    .min(1, "objects.name: obrigatorio.")
    .max(40, "objects.name: maximo 40 caracteres."),
  imageDataUrl: z
    .string()
    .trim()
    .min(1, "objects.imageDataUrl: obrigatorio.")
    .max(2_000_000, "objects.imageDataUrl: muito grande."),
  maskWidth: z.number().int("objects.maskWidth: inteiro.").min(1, "objects.maskWidth: minimo 1.").max(8),
  maskHeight: z.number().int("objects.maskHeight: inteiro.").min(1, "objects.maskHeight: minimo 1.").max(8),
  solid: z.boolean(),
  cropX: z.number().int("objects.cropX: inteiro.").min(0).max(20_000).nullable().optional(),
  cropY: z.number().int("objects.cropY: inteiro.").min(0).max(20_000).nullable().optional(),
  cropWidth: z.number().int("objects.cropWidth: inteiro.").min(1).max(20_000).nullable().optional(),
  cropHeight: z.number().int("objects.cropHeight: inteiro.").min(1).max(20_000).nullable().optional()
});

const mapLayerSchema = z.object({
  id: z.string().trim().min(1, "layers.id: obrigatorio.").max(48, "layers.id: maximo 48 caracteres."),
  name: z.string().trim().min(1, "layers.name: obrigatorio.").max(40, "layers.name: maximo 40 caracteres."),
  visible: z.boolean(),
  tiles: z
    .array(z.array(z.string().trim().min(1).max(48).nullable()))
    .length(MAP_SIZE, `layers.tiles: precisa ter ${MAP_SIZE} linhas.`)
    .refine(
      (rows) => rows.every((row) => Array.isArray(row) && row.length === MAP_SIZE),
      `layers.tiles: cada linha precisa ter ${MAP_SIZE} colunas.`
    )
});

const enemySpawnSchema = z.object({
  id: z.string().trim().min(1).max(48),
  name: z.string().trim().min(1).max(40),
  x: z.number().int().min(0).max(MAP_SIZE - 1),
  y: z.number().int().min(0).max(MAP_SIZE - 1),
  enemyType: z.enum(["WARRIOR", "MONK"]),
  spawnCount: z.number().int().min(1).max(10),
  warriorCount: z.number().int().min(0).max(10).optional(),
  monkCount: z.number().int().min(0).max(10).optional()
});

const saveMapBodySchema = z.object({
  mapKey: z.string().trim().min(1).max(32).optional(),
  name: z.string().trim().min(1, "name: obrigatorio.").max(40, "name: maximo 40 caracteres."),
  mapSize: z
    .number()
    .int("mapSize: inteiro.")
    .refine((value) => value === MAP_SIZE, `mapSize: neste prototipo deve ser ${MAP_SIZE}.`),
  objects: z.array(mapObjectSchema).max(256, "objects: maximo 256 objetos."),
  layers: z.array(mapLayerSchema).min(1, "layers: minimo 1 layer.").max(32, "layers: maximo 32 layers."),
  enemySpawns: z.array(enemySpawnSchema).max(100).optional()
});

// Tecnico: Tipos inferidos automaticamente do schema.
// Crianca: TypeScript aprende o formato certo sozinho.
export type AuthBody = z.infer<typeof authBodySchema>;
export type RegisterBody = AuthBody & { playerType: PlayerType };
export type CreateCharacterBody = z.infer<typeof createCharacterBodySchema>;
export type InventoryUpdateBody = z.infer<typeof inventoryUpdateBodySchema>;
export type MovePayload = z.infer<typeof movePayloadSchema>;
export type AttackPayload = z.infer<typeof attackPayloadSchema>;
export type SaveMapObjectBody = z.infer<typeof mapObjectSchema>;
export type SaveMapLayerBody = z.infer<typeof mapLayerSchema>;
export type SaveMapBody = {
  mapKey: string;
  name: string;
  mapSize: number;
  objects: SaveMapObjectBody[];
  layers: SaveMapLayerBody[];
  enemySpawns?: z.infer<typeof enemySpawnSchema>[];
};

function falharComZod(error: z.ZodError): ValidationResult<never> {
  // Tecnico: Converte ZodError para lista de mensagens simples.
  // Crianca: Traduz o erro tecnico para frases pequenas.
  return {
    ok: false,
    errors: error.issues.map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    })
  };
}

function validarComSchema<T>(schema: z.ZodType<T>, payload: unknown): ValidationResult<T> {
  // Tecnico: safeParse evita throw e facilita fluxo linear.
  // Crianca: Testa com calma sem derrubar o programa.
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return falharComZod(parsed.error);
  }

  return {
    ok: true,
    data: parsed.data
  };
}

export function validarCorpoCadastro(body: unknown): ValidationResult<RegisterBody> {
  const parsed = validarComSchema(registerBodySchema, body);
  if (!parsed.ok) {
    return parsed;
  }

  return {
    ok: true,
    data: {
      ...parsed.data,
      playerType: parsed.data.playerType ?? PlayerType.WARRIOR
    }
  };
}

export function validarCorpoLogin(body: unknown): ValidationResult<AuthBody> {
  return validarComSchema(authBodySchema, body);
}

export function validarCorpoCriarPersonagem(body: unknown): ValidationResult<CreateCharacterBody> {
  return validarComSchema(createCharacterBodySchema, body);
}

export function validarCorpoAtualizarInventario(body: unknown): ValidationResult<InventoryUpdateBody> {
  return validarComSchema(inventoryUpdateBodySchema, body);
}

export function validarPayloadMovimento(payload: unknown): ValidationResult<MovePayload> {
  return validarComSchema(movePayloadSchema, payload);
}

export function validarPayloadAtaque(payload: unknown): ValidationResult<AttackPayload> {
  return validarComSchema(attackPayloadSchema, payload);
}

export function validarCorpoSalvarMapa(body: unknown): ValidationResult<SaveMapBody> {
  const parsed = validarComSchema(saveMapBodySchema, body);
  if (!parsed.ok) {
    return parsed;
  }

  return {
    ok: true,
    data: {
      ...parsed.data,
      mapKey: (parsed.data.mapKey ?? "default").trim().toLowerCase()
    }
  };
}
