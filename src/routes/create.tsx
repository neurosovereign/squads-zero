'use client';
import CreateSquadForm from '@/components/CreateSquadForm';
import { Card, CardContent } from '@/components/ui/card';
import { ErrorBoundary } from '../components/ErrorBoundary';

export default function CreateSquad() {
  return (
    <ErrorBoundary>
      <div className="">
        <div className="mb-4 flex-col space-y-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight">Create a Squad</h1>
          <h3 className="text-sm text-muted-foreground">
            Create a Squad and set it as your default account.
          </h3>
        </div>
        <Card className="pt-5">
          <CardContent>
            <CreateSquadForm />
          </CardContent>
        </Card>
      </div>
    </ErrorBoundary>
  );
}
