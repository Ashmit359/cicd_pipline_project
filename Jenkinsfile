pipeline {

    // Run all stages on your Jenkins agent
    agent {
        label 'docker-agent'
    }

    // General pipeline settings
    options {
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '10'))
        timeout(time: 45, unit: 'MINUTES')
    }

    // AWS and application configuration
    environment {
        AWS_ACCOUNT_ID = '499133675204'
        AWS_REGION     = 'ap-south-1'

        ECR_REPO       = 'devops-portfolio'
        ECR_REGISTRY   = '499133675204.dkr.ecr.ap-south-1.amazonaws.com'

        S3_BUCKET      = 'ashmit-devops-artifacts-499133675204'

        EKS_CLUSTER    = 'prod-eks'
        K8S_NS         = 'production'
    }

    stages {

        // 1. Get source code from the configured main branch
        stage('1. Checkout Git') {
            steps {
                checkout scm

                script {
                    env.GIT_SHORT = sh(
                        script: 'git rev-parse --short HEAD',
                        returnStdout: true
                    ).trim()

                    env.IMAGE_TAG = "${BUILD_NUMBER}-${env.GIT_SHORT}"

                    env.IMAGE_URI = "${ECR_REGISTRY}/${ECR_REPO}:${env.IMAGE_TAG}"

                    echo "Git commit: ${env.GIT_SHORT}"
                    echo "Docker image: ${env.IMAGE_URI}"
                }
            }
        }

        // 2. Install exact dependencies from package-lock.json
        stage('2. Install Dependencies') {
            steps {
                sh 'npm ci'
            }
        }

        // 3. Check code quality and TypeScript
        stage('3. Lint and Type Check') {
            steps {
                sh 'npm run lint'
                sh 'npm run typecheck'
            }
        }

        // 4. Run application tests
        stage('4. Unit Tests') {
            steps {
                sh 'npm test'
            }
        }

        // 5. Run SonarQube analysis
        stage('5. SonarQube Analysis') {
            steps {
                withCredentials([
                    string(
                        credentialsId: 'sonar-token',
                        variable: 'SONAR_TOKEN'
                    ),
                    string(
                        credentialsId: 'sonar-host-url',
                        variable: 'SONAR_HOST'
                    )
                ]) {
                    sh '''
                        sonar-scanner \
                          -Dsonar.host.url="$SONAR_HOST" \
                          -Dsonar.token="$SONAR_TOKEN" \
                          -Dsonar.qualitygate.wait=true
                    '''
                }
            }
        }

        // 6. Check production dependencies for critical vulnerabilities
        stage('6. Dependency Scan') {
            steps {
                sh 'npm audit --omit=dev --audit-level=critical'
            }
        }

        // 7. Build the application
        stage('7. Build Application') {
            steps {
                sh 'npm run build'
            }
        }

        // 8. Save the build artifact in S3
        stage('8. Upload Artifact to S3') {
            steps {
                sh '''
                    tar -czf app-${IMAGE_TAG}.tar.gz \
                      dist package.json package-lock.json

                    aws s3 cp \
                      app-${IMAGE_TAG}.tar.gz \
                      s3://${S3_BUCKET}/artifacts/main/app-${IMAGE_TAG}.tar.gz
                '''
            }
        }

        // 9. Build the Docker image
        stage('9. Docker Build') {
            steps {
                sh 'docker build -t ${IMAGE_URI} .'
            }
        }

        // 10. Scan the Docker image
        stage('10. Trivy Image Scan') {
            steps {
                sh '''
                    trivy image \
                      --exit-code 1 \
                      --severity CRITICAL \
                      --ignore-unfixed \
                      --no-progress \
                      ${IMAGE_URI}
                '''
            }
        }

        // 11. Authenticate with AWS ECR and push the image
        stage('11. Push Image to ECR') {
            steps {
                sh '''
                    aws ecr get-login-password \
                      --region ${AWS_REGION} \
                    | docker login \
                      --username AWS \
                      --password-stdin ${ECR_REGISTRY}

                    docker push ${IMAGE_URI}
                '''
            }
        }

        // 12. Wait for your manual approval before production deployment
        stage('12. Production Approval') {
            steps {
                input(
                    message: "Deploy ${IMAGE_TAG} to PRODUCTION?",
                    ok: 'Deploy'
                )
            }
        }

        // 13. Deploy the application to EKS
        stage('13. Deploy to EKS') {
            steps {
                withCredentials([
                    string(
                        credentialsId: 'db-password',
                        variable: 'DB_PASSWORD'
                    )
                ]) {
                    sh '''
                        set -eu

                        # Connect kubectl to the EKS cluster
                        aws eks update-kubeconfig \
                          --name ${EKS_CLUSTER} \
                          --region ${AWS_REGION}

                        # Create the namespace and application configuration
                        kubectl apply -f k8s/00-namespace.yaml
                        kubectl apply -f k8s/01-configmap.yaml

                        # Create or update the database Secret
                        kubectl -n ${K8S_NS} create secret generic app-secret \
                          --from-literal=DB_USER=appadmin \
                          --from-literal=DB_PASSWORD="$DB_PASSWORD" \
                          --dry-run=client -o yaml \
                        | kubectl apply -f -

                        # Set the new Docker image in the Deployment manifest
                        sed -i "s|IMAGE_PLACEHOLDER|${IMAGE_URI}|g" \
                          k8s/02-deployment.yaml

                        # Apply Kubernetes resources
                        kubectl apply -f k8s/02-deployment.yaml
                        kubectl apply -f k8s/03-service.yaml
                        kubectl apply -f k8s/04-ingress.yaml
                        kubectl apply -f k8s/05-hpa.yaml

                        # Wait for the new version to become ready
                        if ! kubectl -n ${K8S_NS} rollout status \
                          deployment/devops-portfolio \
                          --timeout=180s; then

                            echo "Deployment failed. Rolling back..."

                            kubectl -n ${K8S_NS} rollout undo \
                              deployment/devops-portfolio

                            exit 1
                        fi

                        # Show deployment status
                        kubectl -n ${K8S_NS} get \
                          deploy,pods,svc,ingress,hpa
                    '''
                }
            }
        }
    }

    // Actions performed after the pipeline finishes
    post {

        success {
            echo "SUCCESS: Build ${env.IMAGE_TAG} completed."
        }

        failure {
            echo "FAILED: Build ${env.IMAGE_TAG}. Check the stage logs."
        }

        always {
            // Remove unused Docker images from the agent
            sh 'docker image prune -f || true'

            // Clean the Jenkins workspace
            deleteDir()
        }
    }
}
