interface PageProps {
  params: Promise<{ videoId: string }>
}

export default async function ChatPage({ params }: PageProps) {
  const { videoId } = await params
  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold">Chat for Video: {videoId}</h1>
    </div>
  )
}
