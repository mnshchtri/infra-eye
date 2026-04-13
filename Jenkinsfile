// ============================================================
// InfraEye — CI Pipeline (Continuous Integration Only)
// Runs on every push / PR. Does NOT deploy or push images.
//
// Designed for a local macOS Jenkins agent with Docker Desktop.
// Uses explicit PATH to ensure docker/go/node are discoverable.
// ============================================================
pipeline {
    agent any

    // ── Environment ──────────────────────────────────────────
    environment {
        // Extend PATH to cover Docker Desktop + Homebrew on both
        // Intel (/usr/local) and Apple Silicon (/opt/homebrew) Macs.
        PATH = "/usr/local/bin:/opt/homebrew/bin:/usr/local/go/bin:/Applications/Docker.app/Contents/Resources/bin:${env.PATH}"

        IMAGE_NAME   = "infra-eye"
        GIT_SHA      = sh(script: "git rev-parse --short HEAD", returnStdout: true).trim()
        IMAGE_TAG    = "${env.BRANCH_NAME ?: 'main'}-${GIT_SHA}"

        GO_IMAGE     = "golang:1.25-alpine"
        NODE_IMAGE   = "node:20-alpine"

        // Named Docker volumes — persist caches across builds
        GO_CACHE     = "infra-eye-go-cache"
        NPM_CACHE    = "infra-eye-npm-cache"

        // Google Chat webhook for build notifications
        GCHAT_WEBHOOK = "https://chat.googleapis.com/v1/spaces/AAQAKVMMn1w/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=GHSVE4RYdBawfCMNNqAUGZgIU0PHDUo-nb2qtaCuj9k"
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
                // Notify Google Chat that the build has started
                sh """
                    curl -s -X POST '${GCHAT_WEBHOOK}' \
                        -H 'Content-Type: application/json' \
                        -d '{
                            "text": "🔧 *CI STARTED*\\n*Job:* ${JOB_NAME} #${BUILD_NUMBER}\\n*Branch:* ${env.BRANCH_NAME ?: 'main'}\\n*Commit:* ${GIT_SHA}\\n*Link:* ${BUILD_URL}"
                        }'
                """
            }
        }

        // ── Stage 2: Sanity check ─────────────────────────────
        stage('Verify: Docker') {
            steps {
                sh 'docker version --format "Docker {{.Client.Version}}"'
            }
        }

        // ── Stage 3: Backend CI ───────────────────────────────
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

        // ── Stage 4: Frontend CI ──────────────────────────────
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

        // ── Stage 5: Docker Image Build Validation ────────────
        stage('Docker: Build Validation') {
            steps {
                sh """
                    docker build \
                        --no-cache \
                        --label "git.commit=${GIT_SHA}" \
                        --label "git.branch=${env.BRANCH_NAME ?: 'main'}" \
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
║  Branch : ${env.BRANCH_NAME ?: 'main'}
║  Commit : ${GIT_SHA}
║  Build  : #${env.BUILD_NUMBER}
╚══════════════════════════════════════════╝
"""
            sh """
                curl -s -X POST '${GCHAT_WEBHOOK}' \
                    -H 'Content-Type: application/json' \
                    -d '{
                        "text": "✅ *CI PASSED*\\n*Job:* ${JOB_NAME} #${BUILD_NUMBER}\\n*Branch:* ${env.BRANCH_NAME ?: 'main'}\\n*Commit:* ${GIT_SHA}\\n*Duration:* ${currentBuild.durationString}\\n*Link:* ${BUILD_URL}"
                    }'
            """
        }
        failure {
            echo """
╔══════════════════════════════════════════╗
║  ❌  CI FAILED — ${IMAGE_NAME}:${IMAGE_TAG}
║  Branch : ${env.BRANCH_NAME ?: 'main'}
║  Commit : ${GIT_SHA}
║  Build  : #${env.BUILD_NUMBER}
╚══════════════════════════════════════════╝
"""
            sh """
                curl -s -X POST '${GCHAT_WEBHOOK}' \
                    -H 'Content-Type: application/json' \
                    -d '{
                        "text": "❌ *CI FAILED*\\n*Job:* ${JOB_NAME} #${BUILD_NUMBER}\\n*Branch:* ${env.BRANCH_NAME ?: 'main'}\\n*Commit:* ${GIT_SHA}\\n*Duration:* ${currentBuild.durationString}\\n*Link:* ${BUILD_URL}console"
                    }'
            """
        }
        always {
            cleanWs()
        }
    }
}
