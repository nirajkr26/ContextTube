import { GoogleGenAI } from "@google/genai"

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is not defined")
}

export const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
})

export async function getEmbedding(text: string): Promise<number[]> {
  const response = await ai.models.embedContent({
    model: "gemini-embedding-2",
    contents: text,
  })

  if (!response.embeddings?.[0]?.values) {
    throw new Error("Failed to generate embedding from Gemini API")
  }

  return response.embeddings[0].values
}

export async function getBatchEmbeddings(texts: string[]): Promise<number[][]> {
  const BATCH_SIZE = 100
  const embeddings: number[][] = []

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)

    // We can call embedContent for each item in parallel to maximize throughput
    const batchPromises = batch.map(async (text) => {
      const response = await ai.models.embedContent({
        model: "gemini-embedding-2",
        contents: text,
        config: { outputDimensionality: 768 }
      })
      if (!response.embeddings?.[0]?.values) {
        throw new Error("Failed to generate embedding from Gemini API")
      }
      return response.embeddings[0].values
    })

    const results = await Promise.all(batchPromises)
    embeddings.push(...results)
  }

  return embeddings
}
