import {
  Container,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
  Badge,
  Text,
  Input,
} from "@/components/ui";

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Hero: responsive padding and typography */}
      <section className="py-12 sm:py-16 md:py-20 lg:py-24">
        <Container size="lg" className="text-center">
          <Badge variant="primary" className="mb-4 sm:mb-6">
            Peer-to-peer agricultural trade
          </Badge>
          <Text variant="h1" as="h1" className="mb-4 sm:mb-6">
            AgroCylo Global 🌾
          </Text>
          <Text variant="body" muted className="max-w-2xl mx-auto mb-8 sm:mb-10">
            Welcome to AGROCYLO — secured by Stellar escrow.
          </Text>
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center">
            <Button variant="primary" size="lg">
              Get started
            </Button>
            <Button variant="outline" size="lg">
              Learn more
            </Button>
          </div>
        </Container>
      </section>

      {/* Component showcase: responsive grid */}
      <section className="py-8 sm:py-12 border-t border-border">
        <Container size="lg">
          <Text variant="h2" as="h2" className="mb-6 sm:mb-8 text-center">
            Reusable UI
          </Text>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            <Card variant="elevated" padding="md">
              <CardHeader>
                <CardTitle>Card with actions</CardTitle>
              </CardHeader>
              <CardContent>
                Cards use design tokens and scale padding responsively.
              </CardContent>
              <CardFooter>
                <Button variant="primary" size="sm">
                  Action
                </Button>
                <Button variant="ghost" size="sm">
                  Cancel
                </Button>
              </CardFooter>
            </Card>
            <Card variant="outlined" padding="md">
              <CardHeader>
                <CardTitle>Form field</CardTitle>
              </CardHeader>
              <CardContent>
                <Input
                  label="Email"
                  type="email"
                  placeholder="you@example.com"
                  hint="We'll never share your email."
                />
              </CardContent>
              <CardFooter>
                <Button variant="secondary" size="sm" fullWidth>
                  Submit
                </Button>
              </CardFooter>
            </Card>
            <Card variant="filled" padding="md">
              <CardHeader>
                <CardTitle>Badges</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="primary">Primary</Badge>
                  <Badge variant="secondary">Secondary</Badge>
                  <Badge variant="success">Success</Badge>
                  <Badge variant="outline">Outline</Badge>
                </div>
              </CardContent>
            </Card>
          </div>
        </Container>
      </section>
    </main>
  );
}
