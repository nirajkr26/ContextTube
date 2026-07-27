import { withAuth } from "next-auth/middleware"
import type { NextRequestWithAuth } from "next-auth/middleware"
import type { NextFetchEvent } from "next/server"

const authMiddleware = withAuth({
  pages: {
    signIn: "/login",
  },
})

export default function proxy(req: NextRequestWithAuth, event: NextFetchEvent) {
  return authMiddleware(req, event)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     * - login (login page)
     */
    "/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|login).*)",
  ],
}
