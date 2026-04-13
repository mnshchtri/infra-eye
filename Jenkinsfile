// ============================================================
// InfraEye — CI Pipeline (Continuous Integration Only)
// Runs on every push / PR. Does NOT deploy or push images.
//
// Uses "docker run" inside sh steps instead of agent{docker{}}
// so no Docker Pipeline plugin is required.
// ============================================================
pipeline {
    agent any

    // ── Environment ──────────────────────────────────────────
    environment {
        IMAGE_NAME   = "infra-eye"
        GIT_SHA      = sh(script: "git rev-parse --short HEAD", returnStdout: true).trim()
        IMAGE_TAG    = "${env.BRANCH_NAME ?: 'unknown'}-${GIT_SHA}"

        GO_IMAGE     = "golang:1.22-alpine"
        NODE_IMAGE   = "node:20-alpine"

        // Cache volumes (speeds up repeated runs)
        GO_CACHE     = "infra-eye-go-cache"
        NPM_CACHE    = "infra-eye-npm-cache"
    }

    options {
        buildDiscarder(logRotator(numToKeepStr: '10'))
        timeout(time: 30, unit: 'MINUTES')
        disableConcurrentBuilds()
        timestamps()
    }

    stages {
        // ── Stage 1: Checkout ─────────────────────────────────
        stage('Checkout') {
            steps {
                checkout scm
                sh 'git log --oneline -5'
            }
        }

        // ── Stage 2: Backend CI (runs inside golang container) ─
        stage('Backend: Download Deps') {
            steps {
                sh """
                    docker run --rm \
                        -v "${WORKSPACE}/backend:/app" \
                        -v "${GO_CACHE}:/go/pkg/mod" \
                        -w /app \
                        ${GO_IMAGE} \
                        sh -c 'go mod download && go mod verify'
                """
            }
        }

        stage('Backend: Vet') {
            steps {
                sh """
                    docker run --rm \
                        -v "${WORKSPACE}/backend:/app" \
                        -v "${GO_CACHE}:/go/pkg/mod" \
                        -w /app \
                        ${GO_IMAGE} \
                        go vet ./...
                """
            }
        }

        stage('Backend: Test') {
            steps {
                sh """
                    docker run --rm \
                        -v "${WORKSPACE}/backend:/app" \
                        -v "${GO_CACHE}:/go/pkg/mod" \
                        -w /app \
                        ${GO_IMAGE} \
                        sh -c 'go test -v -race -count=1 -coverprofile=coverage.out ./... 2>&1 | tee test-results.txt'
                """
            }
            post {
                always {
                    dir('backend') {
                        archiveArtifacts artifacts: 'coverage.out', allowEmptyArchive: true
                    }
                }
            }
        }

        stage('Backend: Build Check') {
            steps {
                sh """
                    docker run --rm \
                        -v "${WORKSPACE}/backend:/app" \
                        -v "${GO_CACHE}:/go/pkg/mod" \
                        -w /app \
                        ${GO_IMAGE} \
                        sh -c 'CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /tmp/server-check ./cmd/server/main.go'
                """
                echo '✅ Backend binary compiled successfully'
            }
        }

        // ── Stage 3: Frontend CI (runs inside node container) ──
        stage('Frontend: Install') {
            steps {
                sh """
                    docker run --rm \
                        -v "${WORKSPACE}/frontend:/app" \
                        -v "${NPM_CACHE}:/root/.npm" \
                        -w /app \
                        ${NODE_IMAGE} \
                        npm ci --prefer-offline
                """
            }
        }

        stage('Frontend: Type Check') {
            steps {
                sh """
                    docker run --rm \
                        -v "${WORKSPACE}/frontend:/app" \
                        -v "${NPM_CACHE}:/root/.npm" \
                        -w /app \
                        ${NODE_IMAGE} \
                        npx tsc -b --noEmit
                """
            }
        }

        stage('Frontend: Build') {
            steps {
                sh """
                    docker run --rm \
                        -v "${WORKSPACE}/frontend:/app" \
                        -v "${NPM_CACHE}:/root/.npm" \
                        -w /app \
                        ${NODE_IMAGE} \
                        npm run build
                """
                echo '✅ Frontend bundle compiled successfully'
            }
            post {
                success {
                    archiveArtifacts artifacts: 'frontend/dist/**', allowEmptyArchive: false
                }
            }
        }

        // ── Stage 4: Docker Image Build Validation ────────────
        stage('Docker: Build Validation') {
            steps {
                sh """
                    docker build \
                        --no-cache \
                        --label "git.commit=${GIT_SHA}" \
                        --label "git.branch=${env.BRANCH_NAME ?: 'unknown'}" \
                        --label "build.number=${BUILD_NUMBER}" \
                        -t ${IMAGE_NAME}:ci-${IMAGE_TAG} \
                        -f Dockerfile \
                        .
                """
                echo "✅ Docker image ${IMAGE_NAME}:ci-${IMAGE_TAG} built successfully"
            }
            post {
                always {
                    sh "docker rmi ${IMAGE_NAME}:ci-${IMAGE_TAG} || true"
                }
            }
        }
    }

    // ── Post Actions ──────────────────────────────────────────
    post {
        success {
            echo """
╔══════════════════════════════════════════╗
║  ✅  CI PASSED — ${IMAGE_NAME}:${IMAGE_TAG}
║  Branch : ${env.BRANCH_NAME ?: 'unknown'}
║  Commit : ${GIT_SHA}
║  Build  : #${env.BUILD_NUMBER}
╚══════════════════════════════════════════╝
"""
        }
        failure {
            echo """
╔══════════════════════════════════════════╗
║  ❌  CI FAILED — ${IMAGE_NAME}:${IMAGE_TAG}
║  Branch : ${env.BRANCH_NAME ?: 'unknown'}
║  Commit : ${GIT_SHA}
║  Build  : #${env.BUILD_NUMBER}
╚══════════════════════════════════════════╝
"""
        }
        always {
            cleanWs()
        }
    }
}
