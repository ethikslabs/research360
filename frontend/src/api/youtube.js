const PLAYLIST_ENDPOINT = 'https://www.googleapis.com/youtube/v3/playlistItems'

// snippet.publishedAt on a playlistItems response is the date the video was
// *liked* (added to the playlist), not the video's original publish date.
// It's named likedAt here to prevent future confusion.

export class TokenExpiredError extends Error {
  constructor() {
    super('YouTube token expired')
    this.name = 'TokenExpiredError'
  }
}

function isExpired() {
  try {
    const raw = localStorage.getItem('yt_auth')
    if (!raw) return true
    const { expires_at } = JSON.parse(raw)
    return Date.now() >= expires_at
  } catch {
    return true
  }
}

export async function fetchLikedVideos(token) {
  if (isExpired()) {
    localStorage.removeItem('yt_auth')
    throw new TokenExpiredError()
  }

  const params = new URLSearchParams({
    playlistId: 'LL',
    part: 'snippet',
    maxResults: '25',
  })

  const res = await fetch(`${PLAYLIST_ENDPOINT}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error?.message || `YouTube API error (${res.status})`)
  }

  const data = await res.json()

  return (data.items ?? []).map(item => ({
    videoId: item.snippet.resourceId.videoId,
    title: item.snippet.title,
    channelTitle: item.snippet.channelTitle,
    thumbnail: item.snippet.thumbnails?.medium?.url ?? item.snippet.thumbnails?.default?.url ?? '',
    likedAt: item.snippet.publishedAt, // = date liked, see comment above
  }))
}
