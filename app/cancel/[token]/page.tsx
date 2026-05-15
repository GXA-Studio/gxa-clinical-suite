import { redirect } from 'next/navigation'

// Legacy cancel links (/cancel/[token]) redirect to the unified patient portal.
export default async function CancelPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  redirect(`/manage/${token}`)
}
