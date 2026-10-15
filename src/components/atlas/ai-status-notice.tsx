import { Settings2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ASSISTANT_NAME } from "@/config/brand";

export function AiStatusNotice({ reason }: { reason: string }) {
  return (
    <Alert data-testid="ai-not-configured">
      <Settings2 aria-hidden />
      <AlertTitle>{ASSISTANT_NAME} needs configuration</AlertTitle>
      <AlertDescription>
        <p>
          AI planning is turned off on this server. {reason} Everything else
          works: you can create trips and edit details by hand.
        </p>
      </AlertDescription>
    </Alert>
  );
}
