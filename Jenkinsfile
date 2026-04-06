// ============================================================
// InfraEye — CI Pipeline (Continuous Integration Only)
// Runs on every push / PR. Does NOT deploy or push images.
// ============================================================
pipeline {
    agent any

    // ── Environment ──────────────────────────────────────────
    environment {
        // Docker image tag based on branch + short commit SHA
        IMAGE_NAME  = "infra-eye"
        GIT_SHA     = sh(script: "git rev-parse --short HEAD", returnStdout: true).trim()
        IMAGE_TAG   = "${env.BRANCH_NAME}-${GIT_SHA}"

        // Go settings
        GOPATH      = "${WORKSPACE}/.gopath"
        GO_VERSION  = "1.25"

        // Node settings
        NODE_VERSION = "20"
    }

    options {
        // Keep only the last 10 builds
        buildDiscarder(logRotator(numToKeepStr: '10'))
        // Fail fast on timeout
        timeout(time: 30, unit: 'MINUTES')
        // Prevent concurrent builds on the same branch
        disableConcurrentBuilds()
        // Add timestamps to every log line
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

        // ── Stage 2: Parallel — Backend + Frontend CI ─────────
        stage('CI') {
            parallel {

                // ── Backend ───────────────────────────────────
                stage('Backend') {
                    agent {
                        docker {
                            image "golang:${GO_VERSION}-alpine"
                            args  '-v /var/cache/go:/go/pkg/mod --user root'
                            reuseNode true
                        }
                    }
                    stages {
                        stage('Go: Download Deps') {
                            steps {
                                dir('backend') {
                                    sh 'go mod download'
                                    sh 'go mod verify'
                                }
                            }
                        }
                        stage('Go: Vet') {
                            steps {
                                dir('backend') {
                                    sh 'go vet ./...'
                                }
                            }
                        }
                        stage('Go: Test') {
                            steps {
                                dir('backend') {
                                    sh '''
                                        go test -v -race -count=1 \
                                            -coverprofile=coverage.out \
                                            ./... 2>&1 | tee test-results.txt
                                    '''
                                }
                            }
                            post {
                                always {
                                    // Publish coverage if plugin present
                                    dir('backend') {
                                        archiveArtifacts artifacts: 'coverage.out', allowEmptyArchive: true
                                    }
                                }
                            }
                        }
                        stage('Go: Build Check') {
                            steps {
                                dir('backend') {
                                    sh '''
                                        CGO_ENABLED=0 GOOS=linux \
                                        go build -ldflags="-s -w" \
                                        -o /tmp/server-check \
                                        ./cmd/server/main.go
                                    '''
                                    echo '✅ Backend binary compiled successfully'
                                }
                            }
                        }
                    }
                }

                // ── Frontend ──────────────────────────────────
                stage('Frontend') {
                    agent {
                        docker {
                            image "node:${NODE_VERSION}-alpine"
                            args  '-v /var/cache/npm:/root/.npm --user root'
                            reuseNode true
                        }
                    }
                    stages {
                        stage('NPM: Install') {
                            steps {
                                dir('frontend') {
                                    sh 'npm ci --prefer-offline'
                                }
                            }
                        }
                        stage('TS: Type Check') {
                            steps {
                                dir('frontend') {
                                    sh 'npx tsc -b --noEmit'
                                }
                            }
                        }
                        stage('Vite: Build') {
                            steps {
                                dir('frontend') {
                                    sh 'npm run build'
                                    echo '✅ Frontend bundle compiled successfully'
                                }
                            }
                            post {
                                success {
                                    // Archive the frontend dist for traceability
                                    archiveArtifacts artifacts: 'frontend/dist/**', allowEmptyArchive: false
                                }
                            }
                        }
                    }
                }
            }
        }

        // ── Stage 3: Docker Image Build Validation ────────────
        stage('Docker: Build Validation') {
            steps {
                sh '''
                    docker build \
                        --no-cache \
                        --label "git.commit=${GIT_SHA}" \
                        --label "git.branch=${BRANCH_NAME}" \
                        --label "build.number=${BUILD_NUMBER}" \
                        -t ${IMAGE_NAME}:ci-${IMAGE_TAG} \
                        -f Dockerfile \
                        .
                '''
                echo "✅ Docker image ${IMAGE_NAME}:ci-${IMAGE_TAG} built successfully"
            }
            post {
                always {
                    // Clean up the local CI image to save disk space
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
║  Branch : ${env.BRANCH_NAME}
║  Commit : ${GIT_SHA}
║  Build  : #${env.BUILD_NUMBER}
╚══════════════════════════════════════════╝
"""
        }
        failure {
            echo """
╔══════════════════════════════════════════╗
║  ❌  CI FAILED — ${IMAGE_NAME}:${IMAGE_TAG}
║  Branch : ${env.BRANCH_NAME}
║  Commit : ${GIT_SHA}
║  Build  : #${env.BUILD_NUMBER}
╚══════════════════════════════════════════╝
"""
            // Optional: add mail/Slack notification here
            // mail to: 'team@example.com', subject: "CI FAILED: ${IMAGE_NAME} #${env.BUILD_NUMBER}"
        }
        always {
            // Clean workspace to prevent disk bloat
            cleanWs()
        }
    }
}
