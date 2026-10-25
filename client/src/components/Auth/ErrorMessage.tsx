import { Alert } from '@librechat/client';

export const ErrorMessage = ({ children }: { children: React.ReactNode }) => (
  <Alert
    variant="error"
    icon={false}
    aria-live="assertive"
    elevation="raised"
    size="roomy"
    className="mt-6 text-center"
  >
    {children}
  </Alert>
);
