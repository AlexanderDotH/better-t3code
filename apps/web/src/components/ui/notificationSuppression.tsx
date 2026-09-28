import { createContext, useContext, type ReactNode } from "react";

const NotificationSuppressionContext = createContext(false);

export function shouldSuppressNotification(
  severity: string | null | undefined,
  enabled: boolean,
): boolean {
  return enabled && (severity === "error" || severity === "warning");
}

export function NotificationSuppressionProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  return (
    <NotificationSuppressionContext.Provider value={enabled}>
      {children}
    </NotificationSuppressionContext.Provider>
  );
}

export function useNotificationSuppression(): boolean {
  return useContext(NotificationSuppressionContext);
}
