FROM golang:1.22-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/server ./cmd/server/main.go

FROM alpine:3.19
WORKDIR /app
RUN apk --no-cache add ca-certificates tzdata openssh-client curl

COPY --from=builder /app/server /app/server
COPY .env.example .env

EXPOSE 8080
ENTRYPOINT ["/app/server"]
