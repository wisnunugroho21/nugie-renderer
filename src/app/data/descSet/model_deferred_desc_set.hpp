#pragma once

#include "../../../vulkan/device/device.hpp"
#include "../../../vulkan/buffer/buffer.hpp"
#include "../../../vulkan/descriptor/descriptor_pool.hpp"
#include "../../../vulkan/descriptor/descriptor_set_layout.hpp"

#include <memory>

namespace NugieApp {
	class ModelDeferredDescSet {
		public:
			ModelDeferredDescSet(NugieVulkan::Device* device, uint32_t pointLightNum, uint32_t spotLightNum, 
				NugieVulkan::DescriptorPool* descriptorPool, std::vector<VkDescriptorBufferInfo> uniformBufferInfo[1], 
				VkDescriptorBufferInfo modelsInfo[4], std::vector<VkDescriptorImageInfo> renderTextureInfo[2], 
				std::vector<VkDescriptorImageInfo> objectTexturesInfo[1], uint32_t imageCount);
			~ModelDeferredDescSet();

			VkDescriptorSet getDescriptorSets(int frameIndex) const { return this->descriptorSets[frameIndex]; }
			NugieVulkan::DescriptorSetLayout* getDescSetLayout() const { return this->descSetLayout; }

			void overwrite(std::vector<VkDescriptorBufferInfo> uniformBufferInfo[1], 
				VkDescriptorBufferInfo modelsInfo[4], std::vector<VkDescriptorImageInfo> renderTextureInfo[2], 
				std::vector<VkDescriptorImageInfo> objectTexturesInfo[1]);

		private:
			NugieVulkan::Device* device;
			NugieVulkan::DescriptorPool* descriptorPool;
			uint32_t pointLightNum, spotLightNum, objectTexturesInfoSize;

      NugieVulkan::DescriptorSetLayout* descSetLayout;
			std::vector<VkDescriptorSet> descriptorSets;

			void createDescriptorLayout();
			void createDescriptorSet(std::vector<VkDescriptorBufferInfo> uniformBufferInfo[1], 
				VkDescriptorBufferInfo modelsInfo[4], std::vector<VkDescriptorImageInfo> renderTextureInfo[2], 
				std::vector<VkDescriptorImageInfo> objectTexturesInfo[1], uint32_t imageCount);
	};
	
}