#include "final_desc_set.hpp"
#include "../../../vulkan/descriptor/descriptor_writer.hpp"

namespace NugieApp {
  FinalDescSet::FinalDescSet(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool,
		const std::vector<VkDescriptorImageInfo> &outputImageInfo)
		: device{device}, descriptorPool{descriptorPool} 
	{
		this->createDescriptorLayout();
		this->createDescriptorSet(outputImageInfo);
  }

	FinalDescSet::~FinalDescSet() {
		if (this->descSetLayout != nullptr) delete this->descSetLayout;
	}

	void FinalDescSet::createDescriptorLayout() {
		this->descSetLayout = 
			NugieVulkan::DescriptorSetLayout::Builder(this->device)
				.addBinding(0, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, VK_SHADER_STAGE_FRAGMENT_BIT)
				.build();
	}

  void FinalDescSet::createDescriptorSet(const std::vector<VkDescriptorImageInfo> &outputImageInfo) 
	{	
		this->descriptorSets.clear();
		for (size_t i = 0; i < outputImageInfo.size(); i++) {
			VkDescriptorSet descSet;

			NugieVulkan::DescriptorWriter(this->device, this->descSetLayout, this->descriptorPool)
				.writeImage(0, outputImageInfo[i])
				.build(&descSet);
			
			this->descriptorSets.emplace_back(descSet);
		}
  }

	void FinalDescSet::overwrite(const std::vector<VkDescriptorImageInfo> &outputImageInfo) 
	{
		for (size_t i = 0; i < this->descriptorSets.size(); i++) {
			NugieVulkan::DescriptorWriter(this->device, this->descSetLayout, this->descriptorPool)
				.writeImage(0, outputImageInfo[i])
				.overwrite(&this->descriptorSets[i]);
		}
	}
}