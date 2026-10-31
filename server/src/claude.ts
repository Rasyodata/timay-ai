import Anthropic from '@anthropic-ai/sdk';
import { ApiError } from './errors.ts';
import type { DeepChecker, DeepItem } from './teyit.ts';

const MODEL = 'claude-opus-5-5';

const SYSTEM = `Sen Türk hukukunda uzman, titiz bir avukat yardımcısısın. Görevin bir dilekçedeki dayanakları kaynaklarına göre denetlemek. Hiçbir şeyi tahmin ederek doğrulama; yalnızca sana verilen metinlere dayan.

Her dayanak için bir sonuç ver:
- "yesil": kaynakta iddiayı birebir destekleyen bir cümle var. source_quote alanına o cümleyi kaynaktan HARFİ HARFİNE kopyala.
- "sari": kaynak kısmen destekliyor, bağlam farklı ya da emin değilsin.
- "kirmizi": kaynak iddiayla çelişiyor ya da dosyada hiçbir dayanağı yok.
- "gri": elindeki metinlerle karar veremiyorsun.

Dayanak türleri:
- "karar": dilekçede atıf yapılan Yargıtay/Danıştay kararı. Kaynak, sana verilen karar metnidir. Dilekçenin karara yüklediği anlam karar metninde var mı?
- "kanun": kanun maddesi atfı. Madde metni sana verilmiyor; bildiğin kadarıyla maddenin bu iddiayı düzenleyip düzenlemediğini açıkla, en fazla "sari" ver.
- "olgu": dilekçedeki somut olay iddiaları (tarih, tutar, süre, kişi, olay). Kaynak, dava dosyasındaki olaylar metnidir. Önemli olay iddialarını sen bul.

quote alanı dilekçeden HARFİ HARFİNE, kısa bir parça olmalı (karar ve kanunlarda sana verilen atıf metnini aynen kullan). explanation Türkçe, bir iki cümle olsun.`;

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['karar', 'kanun', 'olgu'] },
          quote: { type: 'string' },
          status: { type: 'string', enum: ['yesil', 'sari', 'kirmizi', 'gri'] },
          explanation: { type: 'string' },
          source_quote: { type: 'string' },
        },
        required: ['kind', 'quote', 'status', 'explanation', 'source_quote'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

/** ANTHROPIC_API_KEY tanımlı değilse derin teyit kapalıdır (null). */
export function createClaudeChecker(apiKey = process.env.ANTHROPIC_API_KEY): DeepChecker | null {
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey });

  return async (input) => {
    const decisions = input.decisions.length
      ? input.decisions
          .map((d) => `<karar esas="${d.esasNo}" karar="${d.kararNo}" mahkeme="${d.court}">\n${d.text.slice(0, 40000)}\n</karar>`)
          .join('\n')
      : '(Arşivde metni bulunan karar yok.)';
    const references = input.references.map((r) => `- [${r.kind}] ${r.quote}`).join('\n') || '(yok)';
    const content = `<dilekce>\n${input.document}\n</dilekce>

<dava_olaylari>
${input.caseFacts || '(Dava dosyasına olay yazılmamış.)'}
</dava_olaylari>

<karar_metinleri>
${decisions}
</karar_metinleri>

Sistemin bulduğu atıflar (her biri için bir sonuç ver):
${references}

Ayrıca dilekçedeki önemli olay iddialarını "olgu" olarak denetle.`;

    let message;
    try {
      message = await client.messages
        .stream({
          model: MODEL,
          max_tokens: 32000,
          thinking: { type: 'adaptive' },
          output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
          system: SYSTEM,
          messages: [{ role: 'user', content }],
        })
        .finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) {
        throw new ApiError(503, 'Claude API anahtarı geçersiz.');
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new ApiError(429, 'Claude şu an yoğun; biraz sonra tekrar deneyin.');
      }
      if (err instanceof Anthropic.APIError) {
        throw new ApiError(502, `Claude isteği başarısız oldu (${err.status ?? 'bağlantı'}).`);
      }
      throw err;
    }

    if (message.stop_reason === 'refusal') throw new ApiError(422, 'Claude bu metni denetlemeyi reddetti.');
    if (message.stop_reason === 'max_tokens') throw new ApiError(422, 'Metin derin teyit için çok uzun.');
    const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    const parsed = JSON.parse(text) as { items: DeepItem[] };
    return { items: parsed.items, model: message.model };
  };
}

/* ---------- Genel yapay zekâ çağrısı (asistan, dilekçe taslağı, sözleşme okuma, içtihat, infaz) ---------- */

export interface AiRequest {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  /** Verilirse yanıt bu JSON şemasına uyar. */
  schema?: Record<string, unknown>;
  effort?: 'low' | 'medium' | 'high';
  maxTokens?: number;
}
export type AiModel = (req: AiRequest) => Promise<{ text: string; model: string }>;

export const AI_MODEL = MODEL;

/** ANTHROPIC_API_KEY tanımlı değilse yapay zekâ kapalıdır (null). */
export function createClaudeModel(apiKey = process.env.ANTHROPIC_API_KEY): AiModel | null {
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey });
  return async (req) => {
    let message;
    try {
      message = await client.messages
        .stream({
          model: MODEL,
          max_tokens: req.maxTokens ?? 32000,
          thinking: { type: 'adaptive' },
          output_config: req.schema
            ? { effort: req.effort ?? 'high', format: { type: 'json_schema', schema: req.schema } }
            : { effort: req.effort ?? 'high' },
          system: req.system,
          messages: req.messages,
        })
        .finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new ApiError(503, 'Claude API anahtarı geçersiz. Render ayarlarındaki ANTHROPIC_API_KEY değerini kontrol edin.');
      if (err instanceof Anthropic.PermissionDeniedError) throw new ApiError(503, 'Claude hesabında bu işlem için yetki ya da bakiye yok.');
      if (err instanceof Anthropic.RateLimitError) throw new ApiError(429, 'Yapay zekâ şu an yoğun; biraz sonra tekrar deneyin.');
      if (err instanceof Anthropic.APIError) throw new ApiError(502, `Yapay zekâ isteği başarısız oldu (${err.status ?? 'bağlantı'}).`);
      throw err;
    }
    if (message.stop_reason === 'refusal') throw new ApiError(422, 'Yapay zekâ bu isteği yanıtlamayı reddetti.');
    if (message.stop_reason === 'max_tokens' && req.schema) throw new ApiError(422, 'Metin yapay zekâ için çok uzun; daha kısa bir bölümle deneyin.');
    const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    return { text, model: message.model };
  };
}
