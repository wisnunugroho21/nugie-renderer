#include "camera.hpp"

namespace nugie {
    Camera::Camera(glm::vec3 position, glm::vec3 up, float yaw, float pitch) 
    : front(glm::vec3(0.0f, 0.0f, -1.0f)), 
      movementSpeed(SPEED), 
      mouseSensitivity(SENSITIVITY), 
      zoom(ZOOM)
    {
        this->position = position;
        this->worldUp = up;
        this->yaw = yaw;
        this->pitch = pitch;

        updateCameraVectors();
    }

    Camera::Camera(float posX, float posY, float posZ, float upX, float upY, float upZ, float yaw, float pitch) 
    : front(glm::vec3(0.0f, 0.0f, -1.0f)), 
      movementSpeed(SPEED), 
      mouseSensitivity(SENSITIVITY), 
      zoom(ZOOM)
    {
        this->position = glm::vec3(posX, posY, posZ);
        this->worldUp = glm::vec3(upX, upY, upZ);
        this->yaw = yaw;
        this->pitch = pitch;

        updateCameraVectors();
    }

    glm::mat4 Camera::getViewMatrix() {
        return glm::lookAt(this->position, this->position + this->front, this->up);
    }

    void Camera::processKeyboard(CameraMovement direction, float deltaTime) {
        float velocity = this->movementSpeed * deltaTime;
        if (direction == FORWARD)
            this->position += this->front * velocity;
        if (direction == BACKWARD)
            this->position -= this->front * velocity;
        if (direction == LEFT)
            this->position -= this->right * velocity;
        if (direction == RIGHT)
            this->position += this->right * velocity;
    }

    void Camera::processMouseMovement(float xoffset, float yoffset, bool constrainPitch) {
        xoffset *= this->mouseSensitivity;
        yoffset *= this->mouseSensitivity;

        this->yaw   += xoffset;
        this->pitch += yoffset;

        // make sure that when pitch is out of bounds, screen doesn't get flipped
        if (constrainPitch)
        {
            if (this->pitch > 89.0f)
                this->pitch = 89.0f;
            if (this->pitch < -89.0f)
                this->pitch = -89.0f;
        }

        // update Front, Right and Up Vectors using the updated Euler angles
        updateCameraVectors();
    }

    void Camera::processMouseScroll(float yoffset) {
        this->zoom -= (float)yoffset;
        if (this->zoom < 1.0f)
            this->zoom = 1.0f;
        if (this->zoom > 45.0f)
            this->zoom = 45.0f;
    }

    void Camera::updateCameraVectors() {
        // calculate the new Front vector
        glm::vec3 newFront;
        newFront.x = cos(glm::radians(this->yaw)) * cos(glm::radians(this->pitch));
        newFront.y = sin(glm::radians(this->pitch));
        newFront.z = sin(glm::radians(this->yaw)) * cos(glm::radians(this->pitch));

        this->front = glm::normalize(newFront);
        // also re-calculate the Right and Up vector
        this->right = glm::normalize(glm::cross(this->front, this->worldUp));  // normalize the vectors, because their length gets closer to 0 the more you look up or down which results in slower movement.
        this->up    = glm::normalize(glm::cross(this->right, this->front));
    }
}