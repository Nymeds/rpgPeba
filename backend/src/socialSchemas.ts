import { z } from "zod";

type ValidationResult<T> = { ok: true; data: T } | { ok: false; errors: string[] };

const nicknameSchema = z
  .string()
  .trim()
  .min(2, "nickname: minimo 2 caracteres.")
  .max(20, "nickname: maximo 20 caracteres.")
  .regex(/^[a-zA-Z0-9_ ]+$/, "nickname: use letras, numeros, underscore e espaco.");

const roomPayloadSchema = z.object({
  roomName: z
    .string()
    .trim()
    .min(2, "roomName: minimo 2 caracteres.")
    .max(24, "roomName: maximo 24 caracteres.")
    .regex(/^[a-zA-Z0-9_\- ]+$/, "roomName: use letras, numeros, underscore, hifen e espaco.")
});

const chatPayloadSchema = z.object({
  text: z.string().trim().min(1, "text: nao pode ser vazio.").max(320, "text: maximo 320 caracteres.")
});

export type RoomPayload = z.infer<typeof roomPayloadSchema>;
export type ChatPayload = z.infer<typeof chatPayloadSchema>;

function falharComZod(error: z.ZodError): ValidationResult<never> {
  return {
    ok: false,
    errors: error.issues.map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    })
  };
}

function validarComSchema<T>(schema: z.ZodType<T>, payload: unknown): ValidationResult<T> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return falharComZod(parsed.error);
  }

  return { ok: true, data: parsed.data };
}

export function validarNicknameSocket(rawNickname: unknown): ValidationResult<string> {
  return validarComSchema(nicknameSchema, rawNickname);
}

export function validarPayloadSala(payload: unknown): ValidationResult<RoomPayload> {
  return validarComSchema(roomPayloadSchema, payload);
}

export function validarPayloadMensagemChat(payload: unknown): ValidationResult<ChatPayload> {
  return validarComSchema(chatPayloadSchema, payload);
}
