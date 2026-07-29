import { NextResponse } from "next/server"
import { getServerSession } from "next-auth/next"
import { authOptions } from "../auth/[...nextauth]/route"
import { db } from "@/db"
import { videos, userVideos, videoChunks } from "@/db/schema"
import { extractYoutubeId } from "@/lib/utils"
import { workflowClient } from "@/lib/upstash"
import { eq, and } from "drizzle-orm"

export async function POST(request: Request) {
  try {
    // 1. Authenticate user session
    const session = await getServerSession(authOptions);
    if (!session?.user || !(session.user as any).id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = (session.user as any).id;

    // const userId = "111710723336307333176";

    // 2. Parse request payload
    const { url } = await request.json()
    if (!url) {
      return NextResponse.json(
        { error: "YouTube URL is required" },
        { status: 400 }
      )
    }

    const videoId = extractYoutubeId(url)
    if (!videoId) {
      return NextResponse.json(
        { error: "Invalid YouTube URL or Video ID" },
        { status: 400 }
      )
    }

    // 3. Check global cache for the video
    const existingVideo = await db
      .select()
      .from(videos)
      .where(eq(videos.id, videoId))
      .limit(1)

    let shouldTrigger = false

    if (existingVideo.length > 0) {
      const videoStatus = existingVideo[0].status

      // Link video to user's dashboard workspace if not already linked
      const existingUserVideo = await db
        .select()
        .from(userVideos)
        .where(
          and(eq(userVideos.userId, userId), eq(userVideos.videoId, videoId))
        )
        .limit(1)

      if (existingUserVideo.length === 0) {
        await db.insert(userVideos).values({
          userId,
          videoId,
        })
      }

      const isStale =
        videoStatus === "processing" &&
        Date.now() - new Date(existingVideo[0].createdAt).getTime() > 30 * 60 * 1000 

      if (videoStatus === "failed" || isStale) {
        // Reset status for retry, clear error message, and update createdAt to reset the stale timer
        await db
          .update(videos)
          .set({
            status: "processing",
            errorMessage: null,
            createdAt: new Date(),
          })
          .where(eq(videos.id, videoId))

        // Delete any potentially created chunks to avoid duplicate embedding errors
        await db.delete(videoChunks).where(eq(videoChunks.videoId, videoId))

        shouldTrigger = true
      } else {
        return NextResponse.json({
          videoId,
          status: videoStatus,
          message:
            videoStatus === "processing"
              ? "Video is currently being processed"
              : "Video found in cache",
        })
      }
    } else {
      // 4. If new: Insert record to global videos cache and user workspace
      await db.insert(videos).values({
        id: videoId,
        status: "processing",
      })

      await db.insert(userVideos).values({
        userId,
        videoId,
      })

      shouldTrigger = true
    }

    if (shouldTrigger) {
      // 5. Trigger asynchronous transcript/vectorization workflow via Upstash Workflow client
      let baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.UPSTASH_WORKFLOW_URL
      if (!baseUrl) {
        let host = request.headers.get("host") || "127.0.0.1:3000"
        if (host.includes("localhost") || host.includes("::1")) {
          host = host.replace("localhost", "127.0.0.1").replace("[::1]", "127.0.0.1").replace("::1", "127.0.0.1")
        }
        const protocol = request.headers.get("x-forwarded-proto") || "http"
        baseUrl = `${protocol}://${host}`
      }
      const workflowUrl = `${baseUrl.replace(/\/$/, "")}/api/workflow`

      try {
        await workflowClient.trigger({
          url: workflowUrl,
          body: { videoId },
        })
      } catch (triggerError) {
        console.error(
          "Failed to trigger Upstash workflow via SDK client:",
          triggerError
        )
        // Fallback for local development or sandbox if QStash credentials are incomplete/invalid
        // Trigger via async background HTTP fetch directly to the API endpoint
        fetch(workflowUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ videoId }),
        }).catch((fetchError) => {
          console.error("Direct fetch trigger fallback failed:", fetchError)
        })
      }
    }

    return NextResponse.json(
      {
        videoId,
        status: "processing",
        message: "Ingestion pipeline successfully triggered",
      },
      { status: 202 }
    )
  } catch (error: any) {
    console.error("Error in process-video route:", error)
    return NextResponse.json(
      { error: error.message || "Failed to process video ingestion" },
      { status: 500 }
    )
  }
}
