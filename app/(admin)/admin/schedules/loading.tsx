import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'

export default function SchedulesLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-4 w-80" />
      </div>
      {[0, 1, 2].map((i) => (
        <Card key={i} className="border-slate-200/70">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-5 w-5 rounded-full" />
              <Skeleton className="h-5 w-36" />
            </div>
            <div className="grid gap-2 sm:grid-cols-7">
              {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                <Skeleton key={d} className="h-20 rounded-md" />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
