import {
  YoutubeTranscriptVideoUnavailableError,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
} from "youtube-transcript"
import axios from "axios"

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)"
const INNERTUBE_API_URL =
  "https://www.youtube.com/youtubei/v1/player?prettyPrint=false"
const INNERTUBE_CLIENT_VERSION = "20.10.38"
const INNERTUBE_CONTEXT = {
  client: {
    clientName: "ANDROID",
    clientVersion: INNERTUBE_CLIENT_VERSION,
  },
}
const INNERTUBE_USER_AGENT = `com.google.android.youtube/${INNERTUBE_CLIENT_VERSION} (Linux; U; Android 14)`
const RE_XML_TRANSCRIPT = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g

interface CaptionTrack {
  baseUrl: string
  name: { simpleText: string }
  vssId: string
  languageCode: string
  kind?: string
  isTranslatable?: boolean
}

export async function fetchEnglishTranscript(videoId: string) {
  let captionTracks: CaptionTrack[] | undefined

  // 1. Try InnerTube API first
  try {
    const { data } = await axios.post(
      INNERTUBE_API_URL,
      {
        context: INNERTUBE_CONTEXT,
        videoId: videoId,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "User-Agent": INNERTUBE_USER_AGENT,
        },
      }
    )
    captionTracks =
      data?.captions?.playerCaptionsTracklistRenderer?.captionTracks
  } catch (err) {
    console.warn("Failed to fetch caption tracks via InnerTube:", err)
  }

  // 2. Fall back to web page scraping if InnerTube failed
  if (!captionTracks || captionTracks.length === 0) {
    try {
      const { data: html } = await axios.get(
        `https://www.youtube.com/watch?v=${videoId}`,
        {
          headers: {
            "User-Agent": USER_AGENT,
          },
        }
      )
      if (html.includes('class="g-recaptcha"')) {
        throw new Error("YouTube captcha triggered")
      }
      if (!html.includes('"playabilityStatus":')) {
        throw new YoutubeTranscriptVideoUnavailableError(videoId)
      }

      // Parse ytInitialPlayerResponse
      const startToken = `var ytInitialPlayerResponse = `
      const startIndex = html.indexOf(startToken)
      if (startIndex !== -1) {
        const jsonStart = startIndex + startToken.length
        let depth = 0
        let jsonStr = ""
        for (let i = jsonStart; i < html.length; i++) {
          if (html[i] === "{") depth++
          else if (html[i] === "}") {
            depth--
            if (depth === 0) {
              jsonStr = html.slice(jsonStart, i + 1)
              break
            }
          }
        }
        if (jsonStr) {
          const playerResponse = JSON.parse(jsonStr)
          captionTracks =
            playerResponse?.captions?.playerCaptionsTracklistRenderer
              ?.captionTracks
        }
      }
    } catch (err) {
      console.warn("Failed to fetch caption tracks via web page scraping:", err)
    }
  }

  if (!captionTracks || captionTracks.length === 0) {
    throw new YoutubeTranscriptDisabledError(videoId)
  }

  // 3. Find the best English track or translate to English
  // Match exact 'en'
  let selectedTrack = captionTracks.find((track) => track.languageCode === "en")
  // Fallback to any 'en-*' (e.g. en-US, en-GB, a.en)
  if (!selectedTrack) {
    selectedTrack = captionTracks.find((track) =>
      track.languageCode.startsWith("en")
    )
  }
  // Fallback to default track with translation parameter
  let needsTranslation = false
  if (!selectedTrack) {
    selectedTrack = captionTracks[0]
    needsTranslation = true
  }

  let transcriptURL = selectedTrack.baseUrl
  if (needsTranslation) {
    transcriptURL = `${transcriptURL}&tlang=en`
  }

  // 4. Fetch the transcript XML
  const { data: transcriptBody } = await axios.get(transcriptURL, {
    headers: {
      "User-Agent": USER_AGENT,
    },
  })

  // 5. Parse the XML (classic and srv3 formats)
  const results = []
  const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g
  let match
  while ((match = pRegex.exec(transcriptBody)) !== null) {
    const startMs = parseInt(match[1], 10)
    const durMs = parseInt(match[2], 10)
    const inner = match[3]
    let text = ""
    const sRegex = /<s[^>]*>([^<]*)<\/s>/g
    let sMatch
    while ((sMatch = sRegex.exec(inner)) !== null) {
      text += sMatch[1]
    }
    if (!text) {
      text = inner.replace(/<[^>]+>/g, "")
    }
    text = decodeEntities(text).trim()
    if (text) {
      results.push({
        text,
        duration: durMs,
        offset: startMs,
        lang: "en",
      })
    }
  }

  if (results.length > 0) {
    return results
  }

  const classicResults = [...transcriptBody.matchAll(RE_XML_TRANSCRIPT)]
  return classicResults.map((result) => ({
    text: decodeEntities(result[3]),
    duration: parseFloat(result[2]),
    offset: parseFloat(result[1]),
    lang: "en",
  }))
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
}

export async function fetchYoutubeMetadata(videoId: string) {
  try {
    const { data } = await axios.get(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    )
    return {
      title: data.title || "Untitled Video",
      channelName: data.author_name || "Unknown Creator",
    }
  } catch (err) {
    console.error("Failed to fetch youtube oembed metadata:", err)
  }
  return {
    title: "Untitled Video",
    channelName: "Unknown Creator",
  }
}
