import { readFile } from 'fs/promises';
import { join } from 'path';

export async function GET() {
  const filePath = join(process.cwd(), 'public', 'chronos_voice_daemon.exe');
  const buffer = await readFile(filePath);

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-msdownload',
      'Content-Disposition': 'attachment; filename="chronos_voice_daemon.exe"',
      'Content-Length': buffer.length.toString(),
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
