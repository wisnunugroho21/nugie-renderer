#pragma once

#include "../../../vulkan/device/device.hpp"
#include "../../../vulkan/buffer/buffer.hpp"
#include "../../../vulkan/descriptor/descriptor_pool.hpp"
#include "../../../vulkan/descriptor/descriptor_set_layout.hpp"

#include <memory>

namespace NugieApp {
	class ForwardDescSet {
		public:
			ForwardDescSet(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool,
				std::vector<VkDescriptorBufferInfo> uniformBufferInfo[1], VkDescriptorBufferInfo modelsInfo[1]);
			~ForwardDescSet();

			VkDescriptorSet getDescriptorSets(int frameIndex) const { return this->descriptorSets[frameIndex]; }
			NugieVulkan::DescriptorSetLayout* getDescSetLayout() const { return this->descSetLayout; }

			void deleteDescriptorSet();
			void createDescriptorSet(std::vector<VkDescriptorBufferInfo> uniformBufferInfo[1], 
				VkDescriptorBufferInfo modelsInfo[1]);

		private:
			NugieVulkan::Device* device;
			NugieVulkan::DescriptorPool* descriptorPool;

      NugieVulkan::DescriptorSetLayout* descSetLayout;
			std::vector<VkDescriptorSet> descriptorSets;

			void createDescriptorLayout();
	};
	
}