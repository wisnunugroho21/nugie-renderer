#include "app.hpp"

#include "../render/render_system.hpp"
#include "../render/basic/basic_render_system.hpp"

namespace nugie {
    Application::Application() {
        std::vector<RenderSystem*> renderSystems;
        renderSystems.emplace_back(new BasicRenderSystem());

        this->device = std::make_unique<Device>();
        this->renderers = std::make_unique<Renderer>(renderSystems);
    }

    void Application::run() {
        this->device->initialize("Nugie Renderer", 640, 480);

        Mesh mesh{
            .positionVertices = {
                glm::vec4{ -0.5, -0.5, 1.0, 1.0 },
                glm::vec4{ +0.5, -0.5, 1.0, 1.0 },
                glm::vec4{ +0.5, +0.5, 1.0, 1.0 },
                glm::vec4{ -0.5, +0.5, 1.0, 1.0 }
            },
            .indices = {
                0, 1, 2,
                0, 2, 3 
            }
        };

        this->renderers->initialize(this->device.get());
        this->renderers->load({ mesh });

        while (this->device->isRunning()) {
            this->device->poolEvents();
            this->renderers->render(this->device.get());
        }

        this->renderers->destroy();
    }
}