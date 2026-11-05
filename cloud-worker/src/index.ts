import { createApp } from './app'
import type { Env } from './env'
import { createPresigner } from './presign'

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return createApp(createPresigner(env)).fetch(request, env)
  }
} satisfies ExportedHandler<Env>
