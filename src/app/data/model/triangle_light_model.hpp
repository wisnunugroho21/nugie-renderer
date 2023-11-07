#pragma once

#include "../../../vulkan/device/device.hpp"
#include "../../../vulkan/buffer/buffer.hpp"
#include "../../../vulkan/command/command_buffer.hpp"
#include "../../utils/bvh/bvh.hpp"
#include "../../general_struct.hpp"

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE
#include <glm/glm.hpp>

#include <vector>
#include <memory>

namespace NugieApp {
	class TriangleLightModel {
    public:
      TriangleLightModel(NugieVulkan::Device* device);
      ~TriangleLightModel();

      VkDescriptorBufferInfo getLightInfo() { return this->triangleLightBuffer->descriptorInfo(); }
      VkDescriptorBufferInfo getBvhInfo() { return this->bvhBuffer->descriptorInfo(); }
      
      void updateTriangleLight(NugieVulkan::CommandBuffer* commandBuffer, std::vector<TriangleLight> lights);

      void updateBvh(NugieVulkan::CommandBuffer* commandBuffer, std::vector<TriangleLight> lights);
      void updateBvh(NugieVulkan::CommandBuffer* commandBuffer, std::vector<BoundBox*> boundBoxes);
      
    private:
      NugieVulkan::Device* device;
      
      NugieVulkan::Buffer* triangleLightStagingBuffer;
			NugieVulkan::Buffer* triangleLightBuffer;

      NugieVulkan::Buffer* bvhStagingBuffer;
			NugieVulkan::Buffer* bvhBuffer;

      void createLightBuffers();
			void createBvhBuffers();
	};
} // namespace nugi
