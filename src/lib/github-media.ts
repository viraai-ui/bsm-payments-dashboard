import { githubRequest } from './workflow-store'

const RAW_GITHUB_PREFIX = 'https://raw.githubusercontent.com/'

function mediaConfig() {
  return {
    owner: process.env.GITHUB_OWNER || 'viraai-ui',
    repo: process.env.GITHUB_REPO || 'bsm-dispatch-dashboard',
    branch: process.env.GITHUB_BRANCH || 'main',
  }
}

function cleanSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._ -]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'video'
}

export async function uploadBufferToGithubMedia(fileName: string, buffer: Buffer, mimeType: string) {
  const { owner, repo, branch } = mediaConfig()
  const safeName = cleanSegment(fileName)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const path = `data/media-uploads/${stamp}-${safeName}`
  const content = buffer.toString('base64')
  await githubRequest(`/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
    method: 'PUT',
    body: JSON.stringify({ message: `Upload media proof ${safeName}`, content, branch }),
  })
  return {
    fileId: `github:${path}`,
    url: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`,
    storedInWorkDrive: false,
    mimeType,
  }
}

export async function deleteGithubMediaFile(fileIdOrUrl: string | null | undefined) {
  const path = githubMediaPath(fileIdOrUrl)
  if (!path) return false
  const current = await githubRequest(`/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`)
  await githubRequest(`/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
    method: 'DELETE',
    body: JSON.stringify({ message: `Delete expired media proof ${path.split('/').pop() || 'file'}`, sha: current.sha, branch: mediaConfig().branch }),
  })
  return true
}

function githubMediaPath(fileIdOrUrl: string | null | undefined) {
  const value = String(fileIdOrUrl || '')
  if (value.startsWith('github:')) return value.slice('github:'.length)
  if (!value.startsWith(RAW_GITHUB_PREFIX)) return ''
  const { owner, repo, branch } = mediaConfig()
  const rawPrefix = `${RAW_GITHUB_PREFIX}${owner}/${repo}/${branch}/`
  return value.startsWith(rawPrefix) ? value.slice(rawPrefix.length) : ''
}
