/**
 * Mock translation worker for unit testing.
 * Plain JavaScript for direct worker execution.
 */
import { parentPort, workerData } from "node:worker_threads";

const MOCK_TRANSLATIONS = {
  Hello: { es: "Hola", zh: "你好", ko: "안녕하세요" },
  "Good morning": { es: "Buenos días", zh: "早上好", ko: "좋은 아침" },
  Goodbye: { es: "Adiós", zh: "再见", ko: "안녕히 가세요" },
  "Hello there.": { es: "Hola.", zh: "你好。", ko: "안녕하세요." },
  "How are you?": { es: "¿Cómo estás?", zh: "你好吗？", ko: "어떻게 지내세요?" },
  "I am fine.": { es: "Estoy bien.", zh: "我很好。", ko: "저는 괜찮아요." },
};

const SENTENCE_SPLITTER = /(?<=[.!?。！？])\s+/;

let targetLanguage = null;
let initialized = false;

function getMockTranslation(text, lang) {
  return MOCK_TRANSLATIONS[text]?.[lang] ?? `[${lang}] ${text}`;
}

async function handleMessage(message) {
  const port = parentPort;
  if (!port) return;

  switch (message.type) {
    case "initialize": {
      targetLanguage = workerData?.targetLanguage;
      initialized = true;
      port.postMessage({
        type: "initialized",
        id: message.id,
        success: true,
      });
      break;
    }

    case "translate": {
      if (!initialized || !targetLanguage) {
        port.postMessage({
          type: "error",
          id: message.id,
          error: "Worker not initialized",
          code: "NOT_INITIALIZED",
        });
        return;
      }

      const translatedText = getMockTranslation(message.text, targetLanguage);
      port.postMessage({
        type: "translated",
        id: message.id,
        result: {
          text: translatedText,
          sourceLanguage: "en",
          targetLanguage,
          isPartial: false,
        },
      });
      break;
    }

    case "translate-stream": {
      if (!initialized || !targetLanguage) {
        port.postMessage({
          type: "error",
          id: message.id,
          error: "Worker not initialized",
          code: "NOT_INITIALIZED",
        });
        return;
      }

      const sentences = message.text.split(SENTENCE_SPLITTER).filter((s) => s.trim());

      if (sentences.length <= 1) {
        const translatedText = getMockTranslation(message.text, targetLanguage);
        port.postMessage({
          type: "translate-stream-complete",
          id: message.id,
          result: {
            text: translatedText,
            sourceLanguage: "en",
            targetLanguage,
            isPartial: false,
          },
        });
        return;
      }

      const translatedParts = [];
      for (let i = 0; i < sentences.length; i++) {
        const translated = getMockTranslation(sentences[i], targetLanguage);
        translatedParts.push(translated);
        const isLast = i === sentences.length - 1;

        if (isLast) {
          port.postMessage({
            type: "translate-stream-complete",
            id: message.id,
            result: {
              text: translatedParts.join(" "),
              sourceLanguage: "en",
              targetLanguage,
              isPartial: false,
            },
          });
        } else {
          port.postMessage({
            type: "translate-stream-partial",
            id: message.id,
            result: {
              text: translatedParts.join(" "),
              sourceLanguage: "en",
              targetLanguage,
              isPartial: true,
            },
          });
        }
      }
      break;
    }

    case "shutdown": {
      initialized = false;
      targetLanguage = null;
      port.postMessage({
        type: "shutdown",
        id: message.id,
        success: true,
      });
      break;
    }
  }
}

if (parentPort) {
  parentPort.on("message", (message) => {
    handleMessage(message);
  });
}
