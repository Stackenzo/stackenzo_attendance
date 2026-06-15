pipeline {
    agent any

    environment {
        SERVER = "thofu@100.126.182.3"
        APP_DIR = "/var/www/stackenzo_attendance"
        BRANCH = "main"
    }

    stages {
        stage('Deploy') {
            steps {
                sshagent(['server-ssh']) {
                    sh '''
                    ssh -o StrictHostKeyChecking=no $SERVER "
                        cd $APP_DIR &&

                        echo 'Saving current commit...' &&
                        git rev-parse HEAD > .last_commit &&

                        echo 'Fetching latest code...' &&
                        git fetch origin $BRANCH &&

                        echo 'Updating code...' &&
                        git reset --hard origin/$BRANCH &&

                        echo 'Building containers...' &&
                        docker compose up -d --build
                    "
                    '''
                }
            }
        }
    }

    post {
        success {
            echo 'Deployment Successful 🚀'
        }

        failure {
            echo 'Deployment Failed ❌ - Rolling Back'

            sshagent(['server-ssh']) {
                sh '''
                ssh -o StrictHostKeyChecking=no $SERVER "
                    cd $APP_DIR &&

                    if [ -f .last_commit ]; then
                        git reset --hard \\$(cat .last_commit)
                        docker compose up -d --build
                    fi
                    "
                '''
            }
        }
    }
}
